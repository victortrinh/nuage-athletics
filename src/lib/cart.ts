import { readCookie } from './preview'
import type { Cart } from './commerce/types'

/**
 * The cart's two cookies.
 *
 * `na_cart` carries the Shopify cart id and nothing else — the id is a
 * capability (anyone holding it can read and mutate that cart), so it is
 * httpOnly and never reaches client JS or a page's rendered HTML. `na_cart_n`
 * exists only so the header link (src/layouts/Base.astro) can show a line
 * count without a Storefront call on every page render; it is deliberately
 * readable and deliberately never trusted for anything but that display —
 * the cart page always reads the real cart via `readCart` before rendering
 * it, and `/api/cart` never takes this cookie's word for what's in the cart.
 */

export const CART_COOKIE = 'na_cart'
export const CART_COUNT_COOKIE = 'na_cart_n'

/** Shopify carts expire client-side after about 10 days of inactivity. */
const CART_MAX_AGE_S = 10 * 24 * 60 * 60

export function readCartId(cookies: string | null): string | undefined {
  return readCookie(cookies, CART_COOKIE)
}

function attrs(secure: boolean, maxAge: number, httpOnly: boolean): string[] {
  const parts = [`Path=/`, `SameSite=Lax`, `Max-Age=${maxAge}`]
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  return parts
}

/**
 * The pair of `Set-Cookie` headers a mutation response carries: the real
 * (httpOnly) cart id, and the display-only (non-httpOnly) line count derived
 * from it. Both always move together — there is no code path that updates
 * one without the other, which is what keeps the readable count from
 * silently drifting away from the cart it's supposed to summarize.
 */
export function cartCookies(cart: Cart | null, secure: boolean): string[] {
  if (!cart || cart.lines.length === 0) return clearCartCookies(secure)
  const count = cart.lines.reduce((sum, line) => sum + line.quantity, 0)
  return [
    [`${CART_COOKIE}=${cart.id}`, ...attrs(secure, CART_MAX_AGE_S, true)].join('; '),
    [`${CART_COUNT_COOKIE}=${count}`, ...attrs(secure, CART_MAX_AGE_S, false)].join('; '),
  ]
}

/** Both cookies cleared together — an empty cart or one Shopify no longer knows. */
export function clearCartCookies(secure: boolean): string[] {
  return [
    [`${CART_COOKIE}=`, ...attrs(secure, 0, true)].join('; '),
    [`${CART_COUNT_COOKIE}=`, ...attrs(secure, 0, false)].join('; '),
  ]
}

/** The readable count only — for a render that just needs to know whether to show the header link. */
export function readCartCount(cookies: string | null): number {
  const raw = readCookie(cookies, CART_COUNT_COOKIE)
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) && n > 0 ? n : 0
}
