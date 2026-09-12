import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { POST } from '../src/pages/api/cart'
import { PREVIEW_COOKIE, issueToken } from '../src/lib/preview'
import { CART_COOKIE, CART_COUNT_COOKIE, CHECKOUT_COOKIE, applyCheckoutReturn } from '../src/lib/cart'
import { resetStorefrontCache } from '../src/lib/commerce/shopify'
import { featuredProduct } from '../src/lib/catalogue'

/**
 * /api/cart, exercised the way test/subscribe.test.ts exercises
 * /api/subscribe: the exported HTTP handler, a constructed `Request`, and a
 * stubbed `fetch` standing in for Shopify's Storefront API — never the
 * adapter's internals directly (test/shopify.test.ts already covers those).
 *
 * COMMERCE_ENABLED is 'false' in wrangler.toml, same as production before the
 * drop, so every test carries a founder-preview cookie — same as the real
 * buy flow these routes serve. SHOPIFY_STOREFRONT_TOKEN is a fixed test-only
 * value (vitest.config.ts); SHOPIFY_STORE_DOMAIN comes from wrangler.toml.
 */

const PRODUCT = featuredProduct('fr-CA')
const VARIANT = PRODUCT.variants.find((v) => v.options?.fit === 'classic' && v.options?.size === 'M')!
const SOLD_OUT_VARIANT = PRODUCT.variants.find((v) => v.options?.fit === 'classic' && v.options?.size === 'XXS')!
const MERCH_ID = `gid://shopify/ProductVariant/${VARIANT.sku}`
const CART_ID = 'gid://shopify/Cart/test-cart'

function gid(sku: string) {
  return `gid://shopify/ProductVariant/${sku}`
}

async function previewCookie(): Promise<string> {
  return `${PREVIEW_COOKIE}=${await issueToken(env.PREVIEW_PASSWORD!)}`
}

function rawCartLine(id: string, merchandiseId: string, quantity: number) {
  return {
    id,
    quantity,
    cost: { totalAmount: { amount: (quantity * 65).toFixed(2), currencyCode: 'CAD' } },
    merchandise: {
      id: merchandiseId,
      sku: VARIANT.sku,
      title: VARIANT.label,
      price: { amount: '65.00', currencyCode: 'CAD' },
    },
  }
}

function rawCart(lines: ReturnType<typeof rawCartLine>[]) {
  const amount = lines.reduce((sum, l) => sum + l.quantity * 65, 0).toFixed(2)
  return {
    id: CART_ID,
    checkoutUrl: 'https://nuage-test.myshopify.com/cart/c/test-cart',
    cost: {
      subtotalAmount: { amount, currencyCode: 'CAD' },
      totalAmount: { amount, currencyCode: 'CAD' },
    },
    lines: { nodes: lines },
  }
}

/**
 * Answers whichever Storefront request the route made, matched by the
 * operation name that appears in every query/mutation this codebase sends
 * (`NuageInventory`, `NuageCartCreate`, …) — good enough to route a stub
 * without parsing GraphQL for real.
 */
function stubShopify(routes: Record<string, (vars: Record<string, unknown>) => unknown>) {
  vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { query: string; variables: Record<string, unknown> }
    for (const [marker, handler] of Object.entries(routes)) {
      if (body.query.includes(marker)) {
        return new Response(JSON.stringify({ data: handler(body.variables) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }
    throw new Error(`test/cart.test.ts: unstubbed Storefront call — ${body.query.slice(0, 60)}`)
  })
}

function inventoryData() {
  return {
    products: {
      nodes: [
        {
          variants: {
            nodes: PRODUCT.variants.map((v) => ({
              id: gid(v.sku),
              sku: v.sku,
              availableForSale: v.sku !== SOLD_OUT_VARIANT.sku,
              price: { amount: '65.00', currencyCode: 'CAD' },
            })),
          },
        },
      ],
    },
  }
}

/** The inventory read plus every cart mutation, all answered from one cart's worth of state — enough for one request's round trip through /api/cart. */
function stubEverything(existingLines: ReturnType<typeof rawCartLine>[] = []) {
  stubShopify({
    NuageInventory: () => inventoryData(),
    NuageCartCreate: (vars) => ({
      cartCreate: {
        cart: rawCart([rawCartLine('gid://shopify/CartLine/1', vars.merchandiseId as string, vars.quantity as number)]),
        userErrors: [],
      },
    }),
    NuageCartLinesAdd: (vars) => ({
      cartLinesAdd: {
        cart: rawCart([
          ...existingLines,
          rawCartLine('gid://shopify/CartLine/2', vars.merchandiseId as string, vars.quantity as number),
        ]),
        userErrors: [],
      },
    }),
    NuageCartLinesUpdate: (vars) => ({
      cartLinesUpdate: {
        cart: rawCart([rawCartLine(vars.lineId as string, MERCH_ID, vars.quantity as number)]),
        userErrors: [],
      },
    }),
    NuageCartLinesRemove: () => ({
      cartLinesRemove: { cart: rawCart([]), userErrors: [] },
    }),
    NuageCartQuery: () => ({ cart: rawCart(existingLines) }),
  })
}

const SITE = 'https://nuageathletics.com'

function jsonContext(body: unknown, cookie: string) {
  const request = new Request(`${SITE}/api/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: SITE },
    body: JSON.stringify(body),
  })
  return { request, url: new URL(request.url) } as Parameters<typeof POST>[0]
}

function formContext(
  fields: Record<string, string | undefined>,
  cookie: string,
  originHeader = SITE
) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) body.set(key, value)
  }
  const request = new Request(`${SITE}/api/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Origin: originHeader },
    body: body.toString(),
  })
  return { request, url: new URL(request.url) } as Parameters<typeof POST>[0]
}

async function readJson(res: Response) {
  return (await res.json()) as { ok: boolean; code?: string; notice?: string }
}

/**
 * The same stub, but with Shopify clamping the add: it writes `available`
 * rather than the quantity asked for and reports the difference as a
 * warning on a mutation that otherwise succeeded — the 2024-10 shape. See
 * `CART_WARNINGS` in src/lib/commerce/shopify.ts.
 */
function stubClampedAdd(available: number, code = 'MERCHANDISE_NOT_ENOUGH_STOCK') {
  stubShopify({
    NuageInventory: () => inventoryData(),
    NuageCartCreate: () => ({
      cartCreate: {
        cart: rawCart([rawCartLine('gid://shopify/CartLine/1', MERCH_ID, available)]),
        userErrors: [],
        warnings: [{ target: 'gid://shopify/CartLine/1', code, message: 'Not enough stock' }],
      },
    }),
    NuageCartLinesAdd: () => ({
      cartLinesAdd: {
        cart: rawCart([rawCartLine('gid://shopify/CartLine/1', MERCH_ID, available)]),
        userErrors: [],
        warnings: [{ target: 'gid://shopify/CartLine/1', code, message: 'Not enough stock' }],
      },
    }),
  })
}

beforeEach(() => {
  resetStorefrontCache()
})

describe('POST /api/cart — gate', () => {
  it('404s without a founder-preview cookie, before looking at the body', async () => {
    const res = await POST(jsonContext({ intent: 'add', fit: 'classic', size: 'M', locale: 'fr-CA' }, ''))
    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ ok: false, code: 'not_found' })
  })
})

describe('POST /api/cart — add (JSON, the hydrated path)', () => {
  it('resolves (fit, size) against the live catalogue and starts a cart', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(jsonContext({ intent: 'add', fit: 'classic', size: 'M', locale: 'fr-CA' }, cookie))

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: true })
    const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('Set-Cookie') ?? '']
    expect(setCookies.some((c) => c.startsWith(`${CART_COOKIE}=${CART_ID}`))).toBe(true)
    expect(setCookies.some((c) => c.startsWith(`${CART_COUNT_COOKIE}=1`))).toBe(true)
    expect(setCookies.every((c) => c.includes('SameSite=Lax'))).toBe(true)
  })

  it('adds to an existing cart when the cart cookie is already set', async () => {
    const existing = [rawCartLine('gid://shopify/CartLine/1', MERCH_ID, 1)]
    stubEverything(existing)
    const cookie = `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}`

    const res = await POST(jsonContext({ intent: 'add', fit: 'classic', size: 'M', locale: 'fr-CA' }, cookie))

    expect(res.status).toBe(200)
    const setCookies = res.headers.getSetCookie?.() ?? []
    expect(setCookies.some((c) => c.startsWith(`${CART_COUNT_COOKIE}=2`))).toBe(true)
  })

  it('refuses a sold-out size rather than adding it', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(jsonContext({ intent: 'add', fit: 'classic', size: 'XXS', locale: 'fr-CA' }, cookie))

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ ok: false, code: 'sold_out' })
  })

  it('refuses a (fit, size) pair that does not resolve to any variant', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(
      jsonContext({ intent: 'add', fit: 'classic', size: 'not-a-size', locale: 'fr-CA' }, cookie)
    )

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ ok: false, code: 'sold_out' })
  })
})

describe('POST /api/cart — add (form-encoded, the no-JS fallback)', () => {
  it('redirects back to the referring page with added=1', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(
      formContext(
        { intent: 'add', fit: 'classic', size: 'M', quantity: '1', locale: 'fr-CA', redirect: '/' },
        cookie
      )
    )

    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/?added=1')
  })

  it('rejects a cross-origin form POST', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(
      formContext(
        { intent: 'add', fit: 'classic', size: 'M', locale: 'fr-CA', redirect: '/' },
        cookie,
        'https://evil.example'
      )
    )

    expect(res.status).toBe(400)
  })

  it('bounces back with ce=sold_out for a sold-out size, and touches no cart', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(
      formContext(
        { intent: 'add', fit: 'classic', size: 'XXS', quantity: '1', locale: 'fr-CA', redirect: '/' },
        cookie
      )
    )

    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/?ce=sold_out')
  })
})

describe('POST /api/cart — update / remove', () => {
  it('updates a line quantity', async () => {
    stubEverything([rawCartLine('gid://shopify/CartLine/1', MERCH_ID, 1)])
    const cookie = `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}`

    const res = await POST(
      formContext(
        { intent: 'update', lineId: 'gid://shopify/CartLine/1', quantity: '3', redirect: '/panier/' },
        cookie
      )
    )

    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/panier/?added=1')
  })

  it('removes a line, clearing the cart cookies once it is empty', async () => {
    stubEverything([rawCartLine('gid://shopify/CartLine/1', MERCH_ID, 1)])
    const cookie = `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}`

    const res = await POST(
      formContext({ intent: 'remove', lineId: 'gid://shopify/CartLine/1', redirect: '/panier/' }, cookie)
    )

    expect(res.status).toBe(303)
    const setCookies = res.headers.getSetCookie?.() ?? []
    expect(setCookies.some((c) => c.startsWith(`${CART_COOKIE}=;`))).toBe(true)
  })

  it('refuses to update a line with no cart cookie at all', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(
      jsonContext({ intent: 'update', lineId: 'gid://shopify/CartLine/1', quantity: 2 }, cookie)
    )

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ ok: false, code: 'cart_gone' })
  })
})

/*
 * The stock ceiling, which is Shopify's and never this route's. The old
 * `max(10)` looked like one and enforced nothing — the band posts
 * `quantity: 1`, so repeated adds walked past it — while also making a line
 * that got above 10 impossible to decrement. What replaces it is
 * `QUANTITY_SANITY_MAX`, a bound on the input only, plus reporting whatever
 * Shopify actually did with the request.
 */
describe('POST /api/cart — the stock ceiling is Shopify’s', () => {
  it('answers ok, but says so, when Shopify clamped the line', async () => {
    stubClampedAdd(2)
    const cookie = await previewCookie()

    const res = await POST(
      jsonContext({ intent: 'add', fit: 'classic', size: 'M', quantity: 5, locale: 'fr-CA' }, cookie)
    )

    // The add succeeded and the cart really did change — it is not a failure.
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: true, notice: 'stock_short' })
    // And the readable count is Shopify's number, not the 5 that was asked for.
    expect(res.headers.getSetCookie().join('; ')).toContain(`${CART_COUNT_COOKIE}=2`)
  })

  it('tells nothing-left apart from not-enough-left', async () => {
    stubClampedAdd(0, 'MERCHANDISE_OUT_OF_STOCK')
    const cookie = await previewCookie()

    const res = await POST(
      jsonContext({ intent: 'add', fit: 'classic', size: 'M', quantity: 1, locale: 'fr-CA' }, cookie)
    )

    expect(await readJson(res)).toEqual({ ok: true, notice: 'stock_gone' })
  })

  it('folds the notice into the redirect for a no-JS submit', async () => {
    stubClampedAdd(2)
    const cookie = await previewCookie()

    const res = await POST(
      formContext(
        { intent: 'add', fit: 'classic', size: 'M', quantity: '5', locale: 'fr-CA', redirect: '/' },
        cookie
      )
    )

    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/?added=stock_short')
  })

  it('stays silent on an ordinary add', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(
      jsonContext({ intent: 'add', fit: 'classic', size: 'M', quantity: 1, locale: 'fr-CA' }, cookie)
    )

    expect(await readJson(res)).toEqual({ ok: true })
  })

  /*
   * The regression the old shared `max(10)` caused: the cart page's "−"
   * posts `line.quantity - 1`, so a line that repeated adds had pushed to 15
   * posted 14, which the schema refused — leaving "+" disabled, "−" a 400,
   * and removing the whole line the only way out.
   */
  it('lets a line above the old cap be decremented', async () => {
    stubEverything([rawCartLine('gid://shopify/CartLine/1', MERCH_ID, 15)])
    const cookie = `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}`

    const res = await POST(
      jsonContext({ intent: 'update', lineId: 'gid://shopify/CartLine/1', quantity: 14 }, cookie)
    )

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: true })
  })

  it('still refuses a quantity no real order could carry', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(
      jsonContext(
        { intent: 'add', fit: 'classic', size: 'M', quantity: 1_000_000, locale: 'fr-CA' },
        cookie
      )
    )

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ ok: false, code: 'bad_request' })
  })
})

describe('POST /api/cart — checkout', () => {
  it('redirects straight to the checkoutUrl Shopify quoted, not to the redirect field', async () => {
    stubEverything([rawCartLine('gid://shopify/CartLine/1', MERCH_ID, 1)])
    const cookie = `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}`

    const res = await POST(formContext({ intent: 'checkout', redirect: '/panier/' }, cookie))

    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('https://nuage-test.myshopify.com/cart/c/test-cart')
  })

  it('refuses to check out an empty cart', async () => {
    stubEverything([])
    const cookie = `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}`

    const res = await POST(formContext({ intent: 'checkout', redirect: '/panier/' }, cookie))

    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/panier/?ce=empty_cart')
  })

  it('refuses to check out with no cart cookie at all', async () => {
    stubEverything()
    const cookie = await previewCookie()

    const res = await POST(jsonContext({ intent: 'checkout' }, cookie))

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ ok: false, code: 'empty_cart' })
  })
})

/*
 * Coming back from Shopify's hosted checkout (#88).
 *
 * The purchase happens on Shopify's page, so the cart turns into an order
 * with no response from this site to write the readable count cookie —
 * which is why the header kept showing the count of a cart that no longer
 * existed. `applyCheckoutReturn` is the one Storefront read that fixes it,
 * bought by the marker cookie the checkout hand-off sets.
 */
describe('returning from Shopify checkout', () => {
  function documentContext(cookie: string, method = 'GET', accept = 'text/html') {
    const request = new Request(`${SITE}/`, { method, headers: { Cookie: cookie, Accept: accept } })
    return { request, url: new URL(request.url), locals: {} as { cartCount?: number } }
  }

  /** Shopify's answer for an id it no longer knows — a completed checkout, or an expired cart. */
  function stubCartGone() {
    stubShopify({ NuageCartQuery: () => ({ cart: null }) })
  }

  it('marks the hand-off so the next page view knows to reconcile', async () => {
    stubEverything([rawCartLine('gid://shopify/CartLine/1', MERCH_ID, 1)])
    const cookie = `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}`

    const res = await POST(formContext({ intent: 'checkout', redirect: '/panier/' }, cookie))

    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${CHECKOUT_COOKIE}=1`))).toBe(true)
    // httpOnly, like the cart id it settles — nothing on the client reads it.
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${CHECKOUT_COOKIE}=1`) && c.includes('HttpOnly'))).toBe(true)
  })

  it('clears both cart cookies and renders 0 once the cart became an order', async () => {
    stubCartGone()
    const context = documentContext(
      `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}; ${CHECKOUT_COOKIE}=1`
    )

    const res = await applyCheckoutReturn(env, context, async () => new Response('page'))

    // The render that lands on the visitor's screen, not the one after it.
    expect(context.locals.cartCount).toBe(0)
    const setCookies = res.headers.getSetCookie()
    expect(setCookies.some((c) => c.startsWith(`${CART_COOKIE}=;`))).toBe(true)
    expect(setCookies.some((c) => c.startsWith(`${CART_COUNT_COOKIE}=;`))).toBe(true)
    // And the marker is spent, so the next page view costs no Storefront call.
    expect(setCookies.some((c) => c.startsWith(`${CHECKOUT_COOKIE}=;`))).toBe(true)
  })

  it('refreshes the count from the real cart when the checkout was abandoned', async () => {
    stubEverything([rawCartLine('gid://shopify/CartLine/1', MERCH_ID, 3)])
    const context = documentContext(
      `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}; ${CHECKOUT_COOKIE}=1`
    )

    const res = await applyCheckoutReturn(env, context, async () => new Response('page'))

    expect(context.locals.cartCount).toBe(3)
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${CART_COUNT_COOKIE}=3`))).toBe(true)
  })

  it('leaves the cart alone — and keeps the marker — when Shopify is unreachable', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 503 }))
    const context = documentContext(
      `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}; ${CHECKOUT_COOKIE}=1`
    )

    const res = await applyCheckoutReturn(env, context, async () => new Response('page'))

    // An outage is not evidence that anyone's cart is empty.
    expect(context.locals.cartCount).toBeUndefined()
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('spends nothing without the marker', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const context = documentContext(`${await previewCookie()}; ${CART_COOKIE}=${CART_ID}`)

    const res = await applyCheckoutReturn(env, context, async () => new Response('page'))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(res.headers.getSetCookie()).toEqual([])
  })

  /*
   * The marker is spent by the render that would otherwise show the stale
   * number. A sub-resource or a fetch() reaching the Worker first would
   * clear it before that render ever happened.
   */
  it('spends nothing on a request that renders no page', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const cookie = `${await previewCookie()}; ${CART_COOKIE}=${CART_ID}; ${CHECKOUT_COOKIE}=1`

    await applyCheckoutReturn(env, documentContext(cookie, 'POST'), async () => new Response('x'))
    await applyCheckoutReturn(env, documentContext(cookie, 'GET', 'image/avif,image/webp,*/*'), async () => new Response('x'))

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does nothing for a visitor with no commerce at all', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const context = documentContext(`${CART_COOKIE}=${CART_ID}; ${CHECKOUT_COOKIE}=1`)

    await applyCheckoutReturn(env, context, async () => new Response('page'))

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
