import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { isLocale, DEFAULT_LOCALE } from '../../i18n/config'
import { CONSENT_VERSION, consentText } from '../../lib/consent'
import { verifyTurnstile } from '../../lib/turnstile'
import { sendConfirmationEmail } from '../../lib/email'
import { safeRedirect } from '../../lib/gate'
import {
  findByEmail,
  insertSubscriber,
  isRateLimited,
  recordAttempt,
  restartOptIn,
} from '../../lib/db'

export const prerender = false

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: z.string().refine(isLocale).catch(DEFAULT_LOCALE),
  // Must be literally true. A missing or false value is a hard failure —
  // CASL requires express consent, so we never infer it.
  consent: z.literal(true),
  turnstileToken: z.string().optional(),
  source: z.string().max(500).nullable().optional(),
  company: z.string().optional(), // honeypot
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * How the result reaches the caller differs by how the request arrived: a
 * fetch() call (SignupForm.tsx, hydrated) wants JSON it can render in place;
 * a native <form> POST (no JS, or JS that hasn't hydrated yet) can't stay on
 * the page, so it gets a redirect back to wherever the visitor was, with the
 * outcome folded into that page's own query string — 'sent=1' or 'se=<code>'
 * — so the next render can show the right state server-side. See the
 * matching read of those params in SignupForm.tsx's callers.
 */
interface Responder {
  ok: () => Response
  fail: (code: string, status: number) => Response
}

function jsonResponder(): Responder {
  return {
    ok: () => json({ ok: true }),
    fail: (code, status) => json({ ok: false, code }, status),
  }
}

function formResponder(redirectField: string, origin: string): Responder {
  function redirectTo(param: string, value: string) {
    // Unlike the password gate's own `to` field, bouncing back to the gate
    // screen itself is exactly right here — that's where this form lives.
    const target = new URL(safeRedirect(redirectField, { excludeGatePath: false }), origin)
    // The hidden `redirect` field is just "the page the visitor was on" and
    // may itself still carry a stale outcome from an earlier round trip
    // (e.g. ?se=rate_limited, resubmitted successfully this time) — clear
    // both before setting the current one so they never coexist.
    target.searchParams.delete('sent')
    target.searchParams.delete('se')
    target.searchParams.set(param, value)
    return new Response(null, { status: 303, headers: { Location: target.pathname + target.search } })
  }
  return {
    ok: () => redirectTo('sent', '1'),
    fail: (code) => redirectTo('se', code),
  }
}

/**
 * A send that never left is not a success. The subscriber row stays — consent
 * was given and CASL requires us to keep that evidence — but the form must not
 * tell someone to check an inbox we failed to reach.
 */
function emailFailed(error: string | undefined, respond: Responder) {
  console.error('confirmation email failed', error)
  return respond.fail('email_failed', 502)
}

/**
 * A native form POST can't attach a Turnstile token — the widget needs JS to
 * render at all, so a no-JS visitor never sees a challenge to solve. Standing
 * anti-abuse for that path is the honeypot below, the per-IP rate limit, and
 * double opt-in (nobody joins the list without clicking a link in their
 * inbox). What has to hold instead is that the POST actually came from this
 * site: same-origin only, checked via whichever of Origin / Sec-Fetch-Site
 * the browser sent. Neither present fails closed — every real browser sends
 * at least one on a same-origin POST.
 */
function isSameOrigin(request: Request, origin: string): boolean {
  const requestOrigin = request.headers.get('Origin')
  if (requestOrigin !== null) return requestOrigin === origin
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  if (fetchSite !== null) return fetchSite === 'same-origin' || fetchSite === 'none'
  return false
}

export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  const ip = request.headers.get('CF-Connecting-IP') ?? clientAddress ?? null
  const userAgent = request.headers.get('User-Agent')
  const isForm = (request.headers.get('Content-Type') ?? '').startsWith(
    'application/x-www-form-urlencoded'
  )

  let raw: Record<string, unknown>
  let respond: Responder

  if (isForm) {
    if (!isSameOrigin(request, url.origin)) return new Response('Bad request', { status: 400 })

    const form = await request.formData().catch(() => null)
    if (!form) return new Response('Bad request', { status: 400 })

    respond = formResponder(String(form.get('redirect') ?? ''), url.origin)
    const consentValue = form.get('consent')
    raw = {
      email: form.get('email'),
      locale: form.get('locale'),
      // The checkbox's native value is 'on' when checked and absent from the
      // form data entirely when not — never a boolean. Anything else stays
      // falsy, so z.literal(true) below still rejects it.
      consent: consentValue === 'on' || consentValue === 'true',
      turnstileToken: form.get('turnstileToken') ?? form.get('cf-turnstile-response') ?? undefined,
      source: form.get('source'),
      company: form.get('company') ?? undefined,
    }
  } else {
    respond = jsonResponder()
    try {
      raw = await request.json()
    } catch {
      return respond.fail('bad_request', 400)
    }
  }

  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    const consentIssue = parsed.error.issues.some((i) => i.path[0] === 'consent')
    return respond.fail(consentIssue ? 'consent_required' : 'invalid_email', 400)
  }

  const input = parsed.data

  // Honeypot: pretend success so bots don't learn anything.
  if (input.company) return respond.ok()

  if (ip && (await isRateLimited(env.DB, ip))) {
    return respond.fail('rate_limited', 429)
  }

  // Skip the challenge only on the form-encoded path — see isSameOrigin's
  // comment for why that's safe. verifyTurnstile treats a missing secret as
  // "don't block", which is exactly the behaviour wanted here; the JSON path
  // keeps passing the real secret and stays strictly enforced.
  const human = await verifyTurnstile(
    input.turnstileToken,
    isForm ? undefined : env.TURNSTILE_SECRET_KEY,
    ip
  )
  if (!human) return respond.fail('challenge_failed', 400)

  if (ip) await recordAttempt(env.DB, ip)

  const siteUrl = env.PUBLIC_SITE_URL ?? url.origin
  const existing = await findByEmail(env.DB, input.email)

  if (existing) {
    if (existing.status === 'confirmed') {
      return respond.fail('already_subscribed', 409)
    }
    // Pending, or previously unsubscribed and now opting back in. Either way
    // this is fresh express consent, so the row restarts at 'pending' with the
    // wording shown just now.
    const token = await restartOptIn(env.DB, {
      email: input.email,
      locale: input.locale,
      consentText: consentText(input.locale),
      consentVersion: CONSENT_VERSION,
    })
    // Only reachable if the row was confirmed between the read above and the
    // write — the same answer as the confirmed branch.
    if (!token) return respond.fail('already_subscribed', 409)

    const resent = await sendConfirmationEmail({
      apiKey: env.RESEND_API_KEY,
      to: input.email,
      locale: input.locale,
      siteUrl,
      token,
    })
    if (!resent.ok) return emailFailed(resent.error, respond)
    return respond.ok()
  }

  const { token } = await insertSubscriber(env.DB, {
    email: input.email,
    locale: input.locale,
    consentText: consentText(input.locale),
    consentVersion: CONSENT_VERSION,
    ip,
    userAgent,
    source: input.source ?? null,
  })

  const sent = await sendConfirmationEmail({
    apiKey: env.RESEND_API_KEY,
    to: input.email,
    locale: input.locale,
    siteUrl,
    token,
  })

  if (!sent.ok) return emailFailed(sent.error, respond)

  return respond.ok()
}
