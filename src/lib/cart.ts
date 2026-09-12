import { commerceEnabled, readCart } from './commerce/index'
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
  const count = cartLineCount(cart)
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

/** What the header shows: units, not lines — two of one size and one of another is three. */
export function cartLineCount(cart: Cart | null): number {
  return cart ? cart.lines.reduce((sum, line) => sum + line.quantity, 0) : 0
}

/** The readable count only — for a render that just needs to know whether to show the header link. */
export function readCartCount(cookies: string | null): number {
  const raw = readCookie(cookies, CART_COUNT_COOKIE)
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * The third cookie: "this visitor is off at Shopify's checkout right now."
 *
 * The count cookie above is only ever written by a response from
 * `/api/cart`, and checkout is the one thing that empties a cart without one
 * — the payment happens on Shopify's hosted page, the cart turns into an
 * order there, and this site is not involved. So the visitor comes back to a
 * header that still says "Panier (1)" for a cart that no longer exists
 * (#88), and nothing on the site ever corrects it: the header count is read
 * from a cookie precisely so that no page view costs a Storefront call.
 *
 * This marker is what buys the one read that does. It is set on the redirect
 * to `cart.checkoutUrl` and read on the next document request, which spends
 * a single Storefront call to ask what the cart is now and then clears the
 * marker. httpOnly like the cart id — nothing on the client has any business
 * with it — and it carries no cart id of its own: the id it settles is
 * whatever `na_cart` holds at the time.
 */
export const CHECKOUT_COOKIE = 'na_cart_co'

/**
 * Long enough to survive a checkout someone leaves open in a tab overnight,
 * short enough that an abandoned one doesn't buy a Storefront read a week
 * later. Either way it is cleared by the first document request that reads
 * it, so this bound only matters for a browser that never comes back.
 */
const CHECKOUT_MAX_AGE_S = 24 * 60 * 60

export function checkoutCookie(secure: boolean): string {
  return [`${CHECKOUT_COOKIE}=1`, ...attrs(secure, CHECKOUT_MAX_AGE_S, true)].join('; ')
}

export function clearCheckoutCookie(secure: boolean): string {
  return [`${CHECKOUT_COOKIE}=`, ...attrs(secure, 0, true)].join('; ')
}

export function checkoutPending(cookies: string | null): boolean {
  return readCookie(cookies, CHECKOUT_COOKIE) === '1'
}

interface SettleEnv {
  SHOPIFY_STORE_DOMAIN?: string
  SHOPIFY_STOREFRONT_TOKEN?: string
  COMMERCE_ENABLED?: string
  PREVIEW_PASSWORD?: string
}

interface SettleContext {
  request: Request
  url: URL
  /** `App.Locals`, structurally — this file is imported by the test suite, which has no Astro globals. */
  locals: { cartCount?: number }
}

/**
 * A checkout only counts as returned-from on a request that renders a page.
 * The visitor's own next document is where the stale number is about to be
 * drawn; an asset, a fetch or a POST to /api/cart is not, and settling on
 * one of those would spend the read and clear the marker before the render
 * that needed it.
 */
function isDocumentRequest(request: Request): boolean {
  if (request.method !== 'GET') return false
  return (request.headers.get('Accept') ?? '').includes('text/html')
}

/**
 * The one Storefront read the header count is otherwise never allowed
 * (src/layouts/Base.astro says why), spent once per checkout hand-off.
 *
 * Shopify turns the cart into an order on its own hosted page, so the first
 * this site hears of a completed purchase is that the cart id it holds no
 * longer resolves — which is exactly what `readCart` answers with (a null
 * cart, reason `ok`, same as an expired one). Whatever comes back, the two
 * cart cookies are rewritten from it and the marker is cleared, so the
 * header agrees with the cart on the very render the visitor lands on
 * rather than one navigation later: `locals.cartCount` carries the number
 * into the layout, because the request's own Cookie header still says the
 * old one.
 *
 * A Storefront failure changes nothing and keeps the marker, so the next
 * document tries again — the alternative is emptying someone's cart in the
 * header because Shopify was briefly unreachable, and an abandoned checkout
 * is a cart that still exists.
 */
export async function applyCheckoutReturn(
  env: SettleEnv,
  context: SettleContext,
  next: () => Promise<Response>
): Promise<Response> {
  const cookies = context.request.headers.get('Cookie')
  if (!checkoutPending(cookies) || !isDocumentRequest(context.request)) return next()
  if (!(await commerceEnabled(env, cookies))) return next()

  const cartId = readCartId(cookies)
  const live = cartId ? await readCart(env, cartId) : null
  if (live && live.reason !== 'ok') return next()

  const cart = live?.cart ?? null
  context.locals.cartCount = cartLineCount(cart)

  const response = await next()
  const secure = context.url.protocol === 'https:'
  for (const cookie of [...cartCookies(cart, secure), clearCheckoutCookie(secure)]) {
    response.headers.append('Set-Cookie', cookie)
  }
  return response
}
