import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLiveProduct } from '../src/lib/commerce/index'
import { normalizeDomain, parsePriceToCents, resetStorefrontCache } from '../src/lib/commerce/shopify'
import { featuredProduct } from '../src/lib/catalogue'

/**
 * The Storefront read, through the seam pages actually call.
 *
 * `getLiveProduct` is what src/pages/index.astro asks for a price, so that is
 * what these assert on — Shopify's HTTP responses are stood in for, and
 * nothing reaches into the adapter's internals. The interesting cases are all
 * failure cases: this read is allowed to come back empty, and every way it
 * does must land on the same no-price render rather than an exception or a
 * number nobody can vouch for.
 */

const ENV = {
  SHOPIFY_STORE_DOMAIN: 'nuage-test.myshopify.com',
  SHOPIFY_STOREFRONT_TOKEN: 'storefront-test-token',
}

const SLUG = featuredProduct('fr-CA').slug
/** Same product, same SKUs, other locale — and so the same Storefront read. */
const SLUG_EN = featuredProduct('en-CA').slug
const SKUS = featuredProduct('fr-CA').variants.map((v) => v.sku)

function variantNode(sku: string, amount = '65.00', available = true, currencyCode = 'CAD') {
  return { sku, availableForSale: available, price: { amount, currencyCode } }
}

function storefrontResponse(variants: ReturnType<typeof variantNode>[]) {
  return new Response(
    JSON.stringify({ data: { products: { nodes: [{ variants: { nodes: variants } }] } } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

/** Answers every Storefront call with `responses`, in order, and counts them. */
function stubStorefront(...responses: (() => Response)[]) {
  const calls: Request[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(input as RequestInfo, init))
    const next = responses.length > 1 ? responses.shift()! : responses[0]
    return next()
  })
  return calls
}

beforeEach(() => {
  // The cache is module-level and would otherwise leak one test's inventory
  // into the next — the same 15s window that makes it useful in production.
  resetStorefrontCache()
})

describe('parsePriceToCents', () => {
  it('reads Shopify decimal strings without a float in the middle', () => {
    expect(parsePriceToCents('65.00')).toBe(6500)
    expect(parsePriceToCents('64.99')).toBe(6499)
    expect(parsePriceToCents('0.05')).toBe(5)
    expect(parsePriceToCents('120')).toBe(12000)
    expect(parsePriceToCents(' 65.5 ')).toBe(6550)
  })

  it('refuses anything that is not one, rather than rounding it into shape', () => {
    expect(parsePriceToCents('')).toBeNull()
    expect(parsePriceToCents('65.000')).toBeNull()
    expect(parsePriceToCents('CA$65')).toBeNull()
    expect(parsePriceToCents('-65.00')).toBeNull()
  })
})

describe('normalizeDomain', () => {
  it('takes the host out of whatever was pasted into the secret', () => {
    expect(normalizeDomain('nuage.myshopify.com')).toBe('nuage.myshopify.com')
    expect(normalizeDomain(' nuage.myshopify.com ')).toBe('nuage.myshopify.com')
    expect(normalizeDomain('https://nuage.myshopify.com')).toBe('nuage.myshopify.com')
    expect(normalizeDomain('https://nuage.myshopify.com/admin/products')).toBe(
      'nuage.myshopify.com'
    )
  })
})

describe('getLiveProduct', () => {
  it('still reaches the store when the domain was pasted as a URL', async () => {
    const calls = stubStorefront(() => storefrontResponse(SKUS.map((sku) => variantNode(sku))))

    const product = await getLiveProduct(
      { ...ENV, SHOPIFY_STORE_DOMAIN: `https://${ENV.SHOPIFY_STORE_DOMAIN}/` },
      SLUG,
      'fr-CA'
    )

    expect(product?.price.amount).toBe(6500)
    expect(calls[0].url).toBe(`https://${ENV.SHOPIFY_STORE_DOMAIN}/api/2026-01/graphql.json`)
  })

  it('prices the catalogue product from Shopify, joined by SKU', async () => {
    stubStorefront(() => storefrontResponse(SKUS.map((sku) => variantNode(sku, '72.50'))))

    const product = await getLiveProduct(ENV, SLUG, 'fr-CA')

    expect(product?.price).toEqual({ amount: 7250, currency: 'CAD' })
    // Copy still comes from the catalogue; only the numbers are Shopify's.
    expect(product?.name).toBe('Manches longues 01')
    expect(product?.variants).toHaveLength(SKUS.length)
    expect(product?.variants.every((v) => v.inStock)).toBe(true)
  })

  it('marks a variant Shopify reports as unavailable out of stock', async () => {
    const soldOut = SKUS[3]
    stubStorefront(() =>
      storefrontResponse(SKUS.map((sku) => variantNode(sku, '65.00', sku !== soldOut)))
    )

    const product = await getLiveProduct(ENV, SLUG, 'fr-CA')

    expect(product?.variants.find((v) => v.sku === soldOut)?.inStock).toBe(false)
    expect(product?.variants.filter((v) => !v.inStock)).toHaveLength(1)
  })

  it('treats a SKU Shopify has never heard of as unsellable, not as a reason to fail', async () => {
    const [first, ...rest] = SKUS
    stubStorefront(() => storefrontResponse(rest.map((sku) => variantNode(sku))))

    const product = await getLiveProduct(ENV, SLUG, 'fr-CA')

    expect(product?.variants.find((v) => v.sku === first)?.inStock).toBe(false)
    expect(product?.price.amount).toBe(6500)
  })

  it('returns null when the store is not configured, without calling anything', async () => {
    const calls = stubStorefront(() => storefrontResponse([]))

    expect(await getLiveProduct({}, SLUG, 'fr-CA')).toBeNull()
    expect(await getLiveProduct({ SHOPIFY_STORE_DOMAIN: ENV.SHOPIFY_STORE_DOMAIN }, SLUG, 'fr-CA'))
      .toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('fails open when the Storefront API errors', async () => {
    stubStorefront(() => new Response('upstream is having a day', { status: 503 }))

    expect(await getLiveProduct(ENV, SLUG, 'fr-CA')).toBeNull()
  })

  it('fails open on a GraphQL error answered with 200', async () => {
    stubStorefront(
      () =>
        new Response(JSON.stringify({ errors: [{ message: 'Access denied' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )

    expect(await getLiveProduct(ENV, SLUG, 'fr-CA')).toBeNull()
  })

  it('fails open when nothing in the store joins to this product', async () => {
    stubStorefront(() => storefrontResponse([variantNode('SOME-OTHER-SKU')]))

    expect(await getLiveProduct(ENV, SLUG, 'fr-CA')).toBeNull()
  })

  it('fails open on a price the site cannot honour: wrong currency', async () => {
    stubStorefront(() => storefrontResponse(SKUS.map((sku) => variantNode(sku, '65.00', true, 'USD'))))

    expect(await getLiveProduct(ENV, SLUG, 'fr-CA')).toBeNull()
  })

  it('fails open rather than quote one variant at another variant’s price', async () => {
    stubStorefront(() =>
      storefrontResponse(SKUS.map((sku, i) => variantNode(sku, i === 0 ? '80.00' : '65.00')))
    )

    expect(await getLiveProduct(ENV, SLUG, 'fr-CA')).toBeNull()
  })

  it('reads once per cache window, and once for a burst of concurrent renders', async () => {
    const calls = stubStorefront(() => storefrontResponse(SKUS.map((sku) => variantNode(sku))))

    const burst = await Promise.all([
      getLiveProduct(ENV, SLUG, 'fr-CA'),
      getLiveProduct(ENV, SLUG_EN, 'en-CA'),
      getLiveProduct(ENV, SLUG, 'fr-CA'),
    ])
    await getLiveProduct(ENV, SLUG, 'fr-CA')

    expect(burst.every((p) => p?.price.amount === 6500)).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('does not cache a failure — the next render tries again', async () => {
    const calls = stubStorefront(
      () => new Response('down', { status: 500 }),
      () => storefrontResponse(SKUS.map((sku) => variantNode(sku)))
    )

    expect(await getLiveProduct(ENV, SLUG, 'fr-CA')).toBeNull()
    expect((await getLiveProduct(ENV, SLUG, 'fr-CA'))?.price.amount).toBe(6500)
    expect(calls).toHaveLength(2)
  })

  it('sends the token as a Storefront header, to the versioned GraphQL endpoint', async () => {
    const calls = stubStorefront(() => storefrontResponse(SKUS.map((sku) => variantNode(sku))))

    await getLiveProduct(ENV, SLUG, 'fr-CA')

    const [request] = calls
    expect(request.url).toMatch(
      /^https:\/\/nuage-test\.myshopify\.com\/api\/\d{4}-\d{2}\/graphql\.json$/
    )
    expect(request.method).toBe('POST')
    expect(request.headers.get('X-Shopify-Storefront-Access-Token')).toBe(ENV.SHOPIFY_STOREFRONT_TOKEN)
  })
})
