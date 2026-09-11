import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getLiveProduct } from '../src/lib/commerce/index'
import { resetStorefrontCache } from '../src/lib/commerce/shopify'
import { featuredProduct } from '../src/lib/catalogue'
import { POST } from '../src/pages/api/webhooks/shopify'

const WEBHOOK_SECRET = 'whsec_test_not_a_real_secret'

const ENV = {
  SHOPIFY_STORE_DOMAIN: 'nuage-test.myshopify.com',
  SHOPIFY_STOREFRONT_TOKEN: 'storefront-test-token',
}

const SLUG = featuredProduct('fr-CA').slug
const SKUS = featuredProduct('fr-CA').variants.map((v) => v.sku)

async function signShopifyPayload(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))
}

function storefrontResponse() {
  return new Response(
    JSON.stringify({
      data: {
        products: {
          nodes: [
            {
              variants: {
                nodes: SKUS.map((sku) => ({
                  id: `gid://shopify/ProductVariant/${sku}`,
                  sku,
                  availableForSale: true,
                  price: { amount: '65.00', currencyCode: 'CAD' },
                })),
              },
            },
          ],
        },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

/** Counts Storefront calls, regardless of what triggered them. */
function stubStorefront() {
  const calls: unknown[] = []
  vi.stubGlobal('fetch', async () => {
    calls.push(true)
    return storefrontResponse()
  })
  return calls
}

async function postWebhook(body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body)
  const request = new Request('https://nuageathletics.com/api/webhooks/shopify', {
    method: 'POST',
    headers,
    body: payload,
  })
  return POST({ request } as Parameters<typeof POST>[0])
}

function orderPaidEvent() {
  return { id: 820982911946154508, email: 'buyer@example.com', total_price: '65.00' }
}

beforeEach(() => {
  // The cache is module-level and would otherwise leak one test's fetch
  // count into the next.
  resetStorefrontCache()
})

describe('POST /api/webhooks/shopify', () => {
  it('accepts a validly signed orders/paid event and invalidates the storefront cache', async () => {
    const calls = stubStorefront()

    // Warm the cache — a second read inside the TTL should not refetch.
    await getLiveProduct(ENV, SLUG, 'fr-CA')
    await getLiveProduct(ENV, SLUG, 'fr-CA')
    expect(calls).toHaveLength(1)

    const event = orderPaidEvent()
    const payload = JSON.stringify(event)
    const signature = await signShopifyPayload(payload, WEBHOOK_SECRET)

    const res = await postWebhook(event, {
      'X-Shopify-Hmac-Sha256': signature,
      'X-Shopify-Topic': 'orders/paid',
    })
    expect(res.status).toBe(200)

    // The cache was invalidated, so this read hits the Storefront API again
    // rather than serving the stale (pre-order) availability.
    await getLiveProduct(ENV, SLUG, 'fr-CA')
    expect(calls).toHaveLength(2)
  })

  it('rejects a bad signature and leaves the cache untouched', async () => {
    const calls = stubStorefront()
    await getLiveProduct(ENV, SLUG, 'fr-CA')
    expect(calls).toHaveLength(1)

    const event = orderPaidEvent()
    const res = await postWebhook(event, {
      'X-Shopify-Hmac-Sha256': 'not-a-real-signature',
      'X-Shopify-Topic': 'orders/paid',
    })
    expect(res.status).toBe(401)

    await getLiveProduct(ENV, SLUG, 'fr-CA')
    expect(calls).toHaveLength(1)
  })

  it('rejects a request with no signature header', async () => {
    const calls = stubStorefront()
    await getLiveProduct(ENV, SLUG, 'fr-CA')
    expect(calls).toHaveLength(1)

    const res = await postWebhook(orderPaidEvent(), { 'X-Shopify-Topic': 'orders/paid' })
    expect(res.status).toBe(401)

    await getLiveProduct(ENV, SLUG, 'fr-CA')
    expect(calls).toHaveLength(1)
  })

  it('ignores a validly signed event of a topic it does not act on', async () => {
    const calls = stubStorefront()
    await getLiveProduct(ENV, SLUG, 'fr-CA')
    expect(calls).toHaveLength(1)

    const event = orderPaidEvent()
    const payload = JSON.stringify(event)
    const signature = await signShopifyPayload(payload, WEBHOOK_SECRET)

    const res = await postWebhook(event, {
      'X-Shopify-Hmac-Sha256': signature,
      'X-Shopify-Topic': 'orders/create',
    })
    expect(res.status).toBe(200)

    await getLiveProduct(ENV, SLUG, 'fr-CA')
    expect(calls).toHaveLength(1)
  })
})
