import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { POST } from '../src/pages/api/cart'
import { PREVIEW_COOKIE, issueToken } from '../src/lib/preview'
import { CART_COOKIE, CART_COUNT_COOKIE } from '../src/lib/cart'
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
    merchandise: { id: merchandiseId, title: VARIANT.label, price: { amount: '65.00', currencyCode: 'CAD' } },
  }
}

function rawCart(lines: ReturnType<typeof rawCartLine>[]) {
  return {
    id: CART_ID,
    checkoutUrl: 'https://nuage-test.myshopify.com/cart/c/test-cart',
    cost: {
      subtotalAmount: {
        amount: lines.reduce((sum, l) => sum + l.quantity * 65, 0).toFixed(2),
        currencyCode: 'CAD',
      },
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
  return (await res.json()) as { ok: boolean; code?: string }
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
