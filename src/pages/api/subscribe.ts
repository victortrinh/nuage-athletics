import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { isLocale, DEFAULT_LOCALE } from '../../i18n/config'
import { CONSENT_VERSION, consentText } from '../../lib/consent'
import { verifyTurnstile } from '../../lib/turnstile'
import { sendConfirmationEmail } from '../../lib/email'
import {
  findByEmail,
  insertSubscriber,
  isRateLimited,
  recordAttempt,
  refreshPendingToken,
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
 * A send that never left is not a success. The subscriber row stays — consent
 * was given and CASL requires us to keep that evidence — but the form must not
 * tell someone to check an inbox we failed to reach.
 */
function emailFailed(error: string | undefined) {
  console.error('confirmation email failed', error)
  return json({ ok: false, code: 'email_failed' }, 502)
}

export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  const ip = request.headers.get('CF-Connecting-IP') ?? clientAddress ?? null
  const userAgent = request.headers.get('User-Agent')

  let parsed
  try {
    parsed = Body.safeParse(await request.json())
  } catch {
    return json({ ok: false, code: 'bad_request' }, 400)
  }

  if (!parsed.success) {
    const consentIssue = parsed.error.issues.some((i) => i.path[0] === 'consent')
    return json(
      { ok: false, code: consentIssue ? 'consent_required' : 'invalid_email' },
      400
    )
  }

  const input = parsed.data

  // Honeypot: pretend success so bots don't learn anything.
  if (input.company) return json({ ok: true })

  if (ip && (await isRateLimited(env.DB, ip))) {
    return json({ ok: false, code: 'rate_limited' }, 429)
  }

  const human = await verifyTurnstile(input.turnstileToken, env.TURNSTILE_SECRET_KEY, ip)
  if (!human) return json({ ok: false, code: 'challenge_failed' }, 400)

  if (ip) await recordAttempt(env.DB, ip)

  const siteUrl = env.PUBLIC_SITE_URL ?? url.origin
  const existing = await findByEmail(env.DB, input.email)

  if (existing) {
    if (existing.status === 'confirmed') {
      return json({ ok: false, code: 'already_subscribed' }, 409)
    }
    // pending or previously unsubscribed: re-send confirmation, fresh consent timestamp
    const token = await refreshPendingToken(env.DB, input.email)
    const resent = await sendConfirmationEmail({
      apiKey: env.RESEND_API_KEY,
      to: input.email,
      locale: input.locale,
      siteUrl,
      token: token || existing.token,
    })
    if (!resent.ok) return emailFailed(resent.error)
    return json({ ok: true })
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

  if (!sent.ok) return emailFailed(sent.error)

  return json({ ok: true })
}
