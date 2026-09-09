import { hmacHex, timingSafeEqual } from './crypto'
import { isRateLimited, recordAttempt } from './db'

/**
 * The founder preview flag.
 *
 * This is the pre-launch password gate's machinery with its polarity reversed.
 * The gate answered "may this visitor see the site at all"; nothing asks that
 * any more — the site is public, and the home page announces the drop instead
 * of demanding a password. What is still needed is the narrower question the
 * gate was being misused to answer: "is this one of us, testing the buy flow
 * before it opens to everyone."
 *
 * The cookie carries a signed expiry, never the password itself: a stolen
 * cookie then reveals nothing reusable, and it stops working on its own. The
 * signing key is PREVIEW_PASSWORD, so changing the password invalidates every
 * session already issued — which is the behaviour you want from the control
 * you reach for when the link has spread further than intended.
 */

export const PREVIEW_COOKIE = 'na_preview'

/** The query parameter that unlocks preview, stripped by the redirect in src/middleware.ts. */
export const PREVIEW_PARAM = 'preview'

const SESSION_MS = 30 * 24 * 60 * 60 * 1000

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
    `${PREVIEW_COOKIE}=${token}`,
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

/** Clears the cookie — the same attributes with an immediate expiry. */
export function clearCookieHeader(secure: boolean): string {
  const parts = [`${PREVIEW_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
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
 * Is this request carrying a valid preview session?
 *
 * A missing PREVIEW_PASSWORD means no preview is configured, which is treated
 * as "nobody is previewing" rather than as an error — the same reasoning the
 * old gate's `siteLocked` used for a lock with no password. The site is fully
 * functional without it; preview is an operator tool, not a dependency.
 */
export async function previewActive(
  env: { PREVIEW_PASSWORD?: string },
  cookies: string | null
): Promise<boolean> {
  if (!env.PREVIEW_PASSWORD) return false
  return tokenIsValid(env.PREVIEW_PASSWORD, readCookie(cookies, PREVIEW_COOKIE))
}

/**
 * Only same-origin paths may be redirected to after unlocking. An absolute URL
 * or a protocol-relative `//evil.example` would turn the unlock endpoint into
 * an open redirect.
 */
export function safeRedirect(target: string | null): string {
  if (!target) return '/'
  if (!target.startsWith('/') || target.startsWith('//')) return '/'
  return target
}

/**
 * Send the visitor back to where they were with the secret stripped, so it
 * stops at this one request rather than living on in browser history, in a
 * bookmark, or in the Referer header of everything the page goes on to load.
 */
function redirectStripped(url: URL, setCookie: string): Response {
  const clean = new URL(url)
  clean.searchParams.delete(PREVIEW_PARAM)
  return new Response(null, {
    status: 303,
    headers: { Location: clean.pathname + clean.search, 'Set-Cookie': setCookie },
  })
}

interface PreviewContext {
  request: Request
  url: URL
  clientAddress?: string
}

interface PreviewEnv {
  DB: D1Database
  PREVIEW_PASSWORD?: string
}

/**
 * The whole of what src/middleware.ts does, minus the `astro:middleware`
 * wrapper — which is the only part of it that cannot be imported outside a
 * built Astro app, and so the only part worth keeping out of here.
 */
export async function applyPreview(
  env: PreviewEnv,
  context: PreviewContext,
  next: () => Promise<Response>
): Promise<Response> {
  const supplied = context.url.searchParams.get(PREVIEW_PARAM)
  const secure = context.url.protocol === 'https:'

  if (supplied !== null && env.PREVIEW_PASSWORD) {
    // `?preview=` with no value leaves preview, so there is a way back to what
    // the public sees without clearing cookies by hand. No rate limit and no
    // secret needed: giving up access is not something to guess at.
    if (supplied === '') {
      return redirectStripped(context.url, clearCookieHeader(secure))
    }

    const ip =
      context.request.headers.get('CF-Connecting-IP') ?? context.clientAddress ?? 'unknown'

    // The secret now travels in a URL, where the gate's password travelled in
    // a POST body. That is strictly easier to guess at, so the rate limit the
    // gate had is not optional here.
    if (await isRateLimited(env.DB, ip, 'preview')) {
      return new Response('Too many attempts', { status: 429 })
    }

    if (!passwordMatches(supplied, env.PREVIEW_PASSWORD)) {
      await recordAttempt(env.DB, ip, 'preview')
      // 404 rather than 401: a wrong guess should not confirm that preview
      // exists here at all.
      return new Response('Not found', { status: 404 })
    }

    return redirectStripped(
      context.url,
      cookieHeader(await issueToken(env.PREVIEW_PASSWORD), secure)
    )
  }

  const response = await next()

  /**
   * A preview render contains things the public must not be served — the price
   * above all, which non-negotiable 5.5 (CLAUDE.md) says we do not show until
   * it is one we intend to honour. Nothing sets Cache-Control anywhere else in
   * this codebase today, so nothing is currently cached and this is belt and
   * braces. It is stated here, at the one place that knows a response is
   * preview-flavoured, precisely so that adding caching later cannot quietly
   * publish a founder's page to everyone.
   */
  if (await previewActive(env, context.request.headers.get('Cookie'))) {
    response.headers.set('Cache-Control', 'private, no-store')
  }

  return response
}
