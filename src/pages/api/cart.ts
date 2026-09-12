import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { isLocale, DEFAULT_LOCALE } from '../../i18n/config.ts'
import { commerceEnabled, getLiveProduct, mutateCart, readCart, type LiveCart } from '../../lib/commerce/index.ts'
import { isSameOrigin, jsonResponder, formResponder, type Responder } from '../../lib/form-endpoint.ts'
import { readCartId, cartCookies } from '../../lib/cart.ts'
import { featuredProduct } from '../../lib/catalogue.ts'
import type { Cart } from '../../lib/commerce/types'

export const prerender = false

/**
 * The one route every cart control on the site posts to — the buy band's
 * add, and every line's quantity update / remove / checkout button on the
 * cart page itself (`src/pages/panier.astro`, `src/pages/en/cart.astro`).
 * Follows `src/pages/api/subscribe.ts`'s degrade-to-native-POST shape via
 * `src/lib/form-endpoint.ts`: form-encoded body, 303 redirect with the
 * outcome folded into `added=1` / `ce=<code>`, read back into the page's
 * initial props — or JSON for the hydrated path (ProductStage.tsx's `onBuy`).
 */

/**
 * A bound on the *input*, not a purchase policy — the distinction matters,
 * because this number used to be mistaken for one.
 *
 * How many of a variant someone may buy is Shopify's answer and only
 * Shopify's: it is the one place that knows the stock, it clamps a line to
 * it on every mutation, and it says so in `Cart.adjustments`
 * (src/lib/commerce/shopify.ts's `CART_WARNINGS`). This exists purely so a
 * hand-rolled POST asking for 10^6 is refused before it reaches the
 * Storefront API, and it sits far above any plausible order so that it
 * never becomes the effective limit — the moment it does, it would be a
 * limit nobody decided on, enforced here and nowhere near the hosted
 * checkout this site hands off to.
 *
 * It was 10, applied per *request*, which enforced nothing at all: the buy
 * band posts `quantity: 1`, so eleven presses of "Ajouter au panier" walked
 * straight past it. Worse, `update` shared the bound, so a line that got
 * above 10 that way could no longer be decremented — the cart page's "−"
 * posts `quantity - 1`, which the schema then refused, leaving both
 * steppers dead and removal the only way out. If a real per-customer limit
 * is ever wanted, it belongs in Shopify (native per-checkout quantity
 * limits, or a checkout-validation Function), where it also binds the
 * checkout — not in this schema, where it binds only the polite path.
 */
const QUANTITY_SANITY_MAX = 99

const AddBody = z.object({
  intent: z.literal('add'),
  // Either the catalogue variant id the hydrated island already resolved, or
  // the raw (fit, size) pair a no-JS submit carries instead — RAC's radios
  // render real named <input type="radio">s, so both land in the same
  // FormData a hydrated fetch() never needs to build. Exactly one arrives in
  // practice; both are re-resolved against the live catalogue below rather
  // than trusted outright.
  variantId: z.string().optional(),
  fit: z.string().optional(),
  size: z.string().optional(),
  quantity: z.coerce.number().int().min(1).max(QUANTITY_SANITY_MAX).default(1),
  locale: z.string().refine(isLocale).catch(DEFAULT_LOCALE),
})
const UpdateBody = z.object({
  intent: z.literal('update'),
  lineId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(QUANTITY_SANITY_MAX),
})
const RemoveBody = z.object({
  intent: z.literal('remove'),
  lineId: z.string().min(1),
})
const CheckoutBody = z.object({ intent: z.literal('checkout') })

const Body = z.discriminatedUnion('intent', [AddBody, UpdateBody, RemoveBody, CheckoutBody])

/** Every response — success or failure — carries the pair of cart cookies, so a stale cookie never survives a request that found out otherwise. */
function withCartCookies(res: Response, cart: Cart | null, secure: boolean): Response {
  for (const cookie of cartCookies(cart, secure)) {
    res.headers.append('Set-Cookie', cookie)
  }
  return res
}

/**
 * What a successful mutation still has to tell the visitor.
 *
 * Shopify clamps a line to the stock it actually has and reports that as a
 * *warning* on a mutation that otherwise succeeded (see `CART_WARNINGS` in
 * src/lib/commerce/shopify.ts). Without this the route answers a bare `ok`
 * to an add it only partly performed, the badge bumps, and the only trace
 * is a quantity on the cart page that the visitor never chose.
 *
 * Undefined when there is nothing to say, which is the ordinary case.
 */
function noticeFor(cart: Cart): string | undefined {
  const adjustment = cart.adjustments[0]
  if (!adjustment) return undefined
  return adjustment.code === 'out-of-stock' ? 'stock_gone' : 'stock_short'
}

/** `LiveCart.reason` is `'ok'` for both "here's the cart" and "Shopify no longer knows that id" — only anything else is a real Storefront failure worth naming on the wire. */
function failureCode(reason: LiveCart['reason']): string {
  return reason === 'ok' ? 'cart_gone' : reason
}

/**
 * Adds a line, and — the one retry this route allows itself — starts a fresh
 * cart if the cookie's id turned out to be one Shopify no longer knows
 * (past its ~10 day TTL, or already turned into an order). Failing the add
 * over a stale cookie would be a worse visitor experience than silently
 * starting over, and nothing about "the cart" is user-visible state to lose:
 * an expired cart has nothing in it any more either way.
 */
async function addToCart(cartId: string | null, merchandiseId: string, quantity: number): Promise<LiveCart> {
  const first = await mutateCart(env, { intent: 'add', cartId, merchandiseId, quantity })
  if (first.reason === 'ok' && !first.cart && cartId) {
    return mutateCart(env, { intent: 'add', cartId: null, merchandiseId, quantity })
  }
  return first
}

/**
 * Resolves an `(fit, size)` pair or a catalogue variant id into the live
 * merchandise id to add — re-read from Shopify here rather than trusted from
 * the request, since the band's own read can be up to 15s stale. Undefined
 * for anything that doesn't resolve to an in-stock variant, which the caller
 * reports as `sold_out` regardless of which of the three ways that happened.
 */
async function resolveMerchandiseId(input: z.infer<typeof AddBody>): Promise<string | undefined> {
  const { product } = await getLiveProduct(env, featuredProduct(input.locale).slug, input.locale)
  const variant = input.variantId
    ? product?.variants.find((v) => v.id === input.variantId)
    : input.fit && input.size
      ? product?.variants.find((v) => v.options?.fit === input.fit && v.options?.size === input.size)
      : undefined
  return variant?.inStock ? variant.merchandiseId : undefined
}

export const POST: APIRoute = async ({ request, url }) => {
  // Same answer the page render got, from the same cookie — otherwise a
  // founder previewing the buy flow would be shown cart controls that 404.
  if (!(await commerceEnabled(env, request.headers.get('Cookie')))) {
    return new Response(JSON.stringify({ ok: false, code: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const isForm = (request.headers.get('Content-Type') ?? '').startsWith(
    'application/x-www-form-urlencoded'
  )
  const secure = url.protocol === 'https:'
  const cartId = readCartId(request.headers.get('Cookie')) ?? null

  let raw: Record<string, unknown>
  let respond: Responder

  if (isForm) {
    if (!isSameOrigin(request, url.origin)) return new Response('Bad request', { status: 400 })
    const form = await request.formData().catch(() => null)
    if (!form) return new Response('Bad request', { status: 400 })
    respond = formResponder('added', 'ce', String(form.get('redirect') ?? ''), url.origin)
    raw = {
      intent: form.get('intent'),
      variantId: form.get('variantId') ?? undefined,
      fit: form.get('fit') ?? undefined,
      size: form.get('size') ?? undefined,
      quantity: form.get('quantity') ?? undefined,
      locale: form.get('locale'),
      lineId: form.get('lineId') ?? undefined,
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
  if (!parsed.success) return respond.fail('bad_request', 400)
  const input = parsed.data

  try {
    if (input.intent === 'checkout') {
      if (!cartId) return respond.fail('empty_cart', 400)
      const { cart, reason } = await readCart(env, cartId)
      if (!cart || cart.lines.length === 0) {
        return withCartCookies(
          respond.fail(reason === 'ok' ? 'empty_cart' : reason, reason === 'ok' ? 400 : 502),
          cart,
          secure
        )
      }
      // Our own read, not visitor input — the `redirect` hidden field above
      // is what safeRedirect() guards; Shopify's checkoutUrl is an absolute
      // URL by design, and handing a visitor off to it is this intent's
      // entire job.
      return withCartCookies(
        new Response(null, { status: 303, headers: { Location: cart.checkoutUrl } }),
        cart,
        secure
      )
    }

    if (input.intent === 'add') {
      // The hydrated island catches this before it ever fetches (see
      // ProductStage.tsx's onSubmit) — this is the no-JS submit's only
      // chance to say "pick a size" rather than the misleading "sold out".
      if (!input.variantId && !(input.fit && input.size)) return respond.fail('no_size', 400)

      const merchandiseId = await resolveMerchandiseId(input)
      if (!merchandiseId) return respond.fail('sold_out', 409)

      const { cart, reason } = await addToCart(cartId, merchandiseId, input.quantity)
      if (!cart) return withCartCookies(respond.fail(failureCode(reason), 502), null, secure)
      return withCartCookies(respond.ok(noticeFor(cart)), cart, secure)
    }

    // update / remove both act on an existing line, which needs an existing cart.
    if (!cartId) return respond.fail('cart_gone', 400)

    const { cart, reason } =
      input.intent === 'update'
        ? await mutateCart(env, {
            intent: 'update',
            cartId,
            lineId: input.lineId,
            quantity: input.quantity,
          })
        : await mutateCart(env, { intent: 'remove', cartId, lineId: input.lineId })

    if (!cart && reason !== 'ok') return withCartCookies(respond.fail(reason, 502), null, secure)
    return withCartCookies(respond.ok(cart ? noticeFor(cart) : undefined), cart, secure)
  } catch (err) {
    console.error('cart operation failed', err)
    return respond.fail('cart_failed', 500)
  }
}
