import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { isLocale, DEFAULT_LOCALE } from '../../i18n/config'
import { CONSENT_VERSION, consentText } from '../../lib/consent'
import { sendConfirmationEmail } from '../../lib/email'
import { isSameOrigin, jsonResponder, formResponder, type Responder } from '../../lib/form-endpoint'
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
  source: z.string().max(500).nullable().optional(),
  company: z.string().optional(), // honeypot
})

/**
 * A send that never left is not a success. The subscriber row stays — consent
 * was given and CASL requires us to keep that evidence — but the form must not
 * tell someone to check an inbox we failed to reach.
 */
function emailFailed(error: string | undefined, respond: Responder) {
  console.error('confirmation email failed', error)
  return respond.fail('email_failed', 502)
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

    respond = formResponder('sent', 'se', String(form.get('redirect') ?? ''), url.origin)
    const consentValue = form.get('consent')
    raw = {
      email: form.get('email'),
      locale: form.get('locale'),
      // The checkbox's native value is 'on' when checked and absent from the
      // form data entirely when not — never a boolean. Anything else stays
      // falsy, so z.literal(true) below still rejects it.
      consent: consentValue === 'on' || consentValue === 'true',
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
