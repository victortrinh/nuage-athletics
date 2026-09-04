import { hmacHex, timingSafeEqual } from './crypto'

/**
 * The pre-launch password gate.
 *
 * The cookie carries a signed expiry, never the password itself: a stolen
 * cookie then reveals nothing reusable, and it stops working on its own. The
 * signing key is SITE_PASSWORD, so changing the password invalidates every
 * session already issued — which is the behaviour you want from the control
 * you reach for when the link has spread further than intended.
 */

export const GATE_COOKIE = 'na_gate'

const SESSION_MS = 30 * 24 * 60 * 60 * 1000

export function siteLocked(env: { SITE_LOCKED?: string; SITE_PASSWORD?: string }): boolean {
  // A lock with no password configured would be unopenable, so it is treated
  // as no lock at all rather than bricking the site on a half-finished deploy.
  return env.SITE_LOCKED === 'true' && Boolean(env.SITE_PASSWORD)
}

export function passwordMatches(supplied: string, expected: string): boolean {
  return timingSafeEqual(supplied, expected)
}

export async function issueToken(secret: string, now: number = Date.now()): Promise<string> {
  const expiry = String(now + SESSION_MS)
  return `${expiry}.${await hmacHex(secret, expiry)}`
}

export async function tokenIsValid(
  secret: string,
  token: string | undefined,
  now: number = Date.now()
): Promise<boolean> {
  if (!token) return false
  const separator = token.indexOf('.')
  if (separator < 1) return false

  const expiry = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  const expiresAt = Number(expiry)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false

  return timingSafeEqual(await hmacHex(secret, expiry), signature)
}

export function cookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${GATE_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ]
  // Secure would make the cookie unsettable over plain http, which is how
  // `wrangler dev` serves the site locally.
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * Paths the gate never covers.
 *
 * The confirm and unsubscribe links are already sitting in inboxes. Locking
 * them would strand people mid-opt-in and, worse, break the unsubscribe path
 * CASL obliges us to keep working — a password wall is not an excuse the law
 * recognises. The subscribe endpoint stays open because the gate screen itself
 * posts to it, and the Stripe webhook because Stripe cannot log in.
 */
const OPEN_PREFIXES = [
  '/api/subscribe',
  '/api/confirm',
  '/api/unsubscribe',
  '/api/webhooks/',
  '/api/gate',
  '/robots.txt',
  '/sitemap',
  '/favicon',
  '/_astro/',
  // The gate screen collects an email address, and its consent wording points
  // at the privacy policy. Collecting consent behind a wall that hides the
  // policy explaining the collection is not consent anyone could call
  // informed, so these two stay reachable while the site is locked.
  '/confidentialite',
  '/conditions',
  '/en/privacy',
  '/en/terms',
]

export function isOpenPath(pathname: string): boolean {
  return OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/** The gate screen itself, per locale — rewriting to it must not re-trigger the gate. */
export const GATE_PATHS = ['/acces', '/en/access'] as const

export function isGatePath(pathname: string): boolean {
  return GATE_PATHS.some((p) => pathname === p || pathname === `${p}/`)
}

/**
 * Only same-origin paths may be redirected to after a successful unlock.
 * An absolute URL or a protocol-relative `//evil.example` would turn the gate
 * into an open redirect.
 *
 * `excludeGatePath` defaults to true for the password gate's own `to` field,
 * which must not loop back to the gate screen itself once unlocked. The
 * signup form's redirect-back target (src/pages/api/subscribe.ts) is the
 * gate screen by design — that's where the form lives — so it opts out.
 */
export function safeRedirect(
  target: string | null,
  { excludeGatePath = true }: { excludeGatePath?: boolean } = {}
): string {
  if (!target) return '/'
  if (!target.startsWith('/') || target.startsWith('//')) return '/'
  if (excludeGatePath && isGatePath(target.split('?')[0])) return '/'
  return target
}
