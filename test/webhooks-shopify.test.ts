import { describe, expect, it, vi, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { getLiveProduct } from '../src/lib/commerce/index'
import { resetStorefrontCache } from '../src/lib/commerce/shopify'
import { featuredProduct } from '../src/lib/catalogue'
import { POST } from '../src/pages/api/webhooks/shopify'
import { confirmSubscriber, findByEmail, insertSubscriber, unsubscribe } from '../src/lib/db'
import { SHOPIFY_CHECKOUT_CONSENT, SHOPIFY_CONSENT_VERSION, CONSENT_VERSION } from '../src/lib/consent'

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

let seq = 0
function uniqueEmail() {
  seq += 1
  return `shopify-customer-${Date.now()}-${seq}@example.com`
}

function customerEvent(
  overrides: {
    email?: string
    locale?: string
    state?: string
    consentUpdatedAt?: string
  } = {}
) {
  return {
    id: 706405506930370084,
    email: overrides.email ?? uniqueEmail(),
    locale: overrides.locale ?? 'fr-CA',
    email_marketing_consent: {
      state: overrides.state ?? 'subscribed',
      opt_in_level: 'single_opt_in',
      consent_updated_at: overrides.consentUpdatedAt ?? '2026-09-01T12:00:00Z',
    },
  }
}

async function postSignedCustomerEvent(event: ReturnType<typeof customerEvent>, topic: string) {
  const payload = JSON.stringify(event)
  const signature = await signShopifyPayload(payload, WEBHOOK_SECRET)
  return postWebhook(event, {
    'X-Shopify-Hmac-Sha256': signature,
    'X-Shopify-Topic': topic,
  })
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

describe('POST /api/webhooks/shopify — customers/create, customers/update', () => {
  it('inserts a confirmed subscriber for an active subscribed state', async () => {
    const email = uniqueEmail()
    const event = customerEvent({ email, locale: 'fr-CA' })

    const res = await postSignedCustomerEvent(event, 'customers/create')
    expect(res.status).toBe(200)

    const row = await findByEmail(env.DB, email)
    expect(row).not.toBeNull()
    expect(row?.status).toBe('confirmed')
    expect(row?.source).toBe('shopify-checkout')
    expect(row?.consent_version).toBe(SHOPIFY_CONSENT_VERSION)
    expect(row?.consent_text).toBe(SHOPIFY_CHECKOUT_CONSENT['fr-CA'])
    // Never the site's own version/wording.
    expect(row?.consent_version).not.toBe(CONSENT_VERSION)
    expect(row?.consented_at).toBe(Date.parse('2026-09-01T12:00:00Z'))
    expect(row?.confirmed_at).toBe(Date.parse('2026-09-01T12:00:00Z'))
  })

  it('does not insert a row for a non-subscribed consent state', async () => {
    const email = uniqueEmail()
    const event = customerEvent({ email, state: 'not_subscribed' })

    const res = await postSignedCustomerEvent(event, 'customers/create')
    expect(res.status).toBe(200)

    expect(await findByEmail(env.DB, email)).toBeNull()
  })

  it('does not insert a row for a pending consent state', async () => {
    const email = uniqueEmail()
    const res = await postSignedCustomerEvent(customerEvent({ email, state: 'pending' }), 'customers/update')
    expect(res.status).toBe(200)
    expect(await findByEmail(env.DB, email)).toBeNull()
  })

  it('never touches an existing unsubscribed row', async () => {
    const email = uniqueEmail()
    const { token } = await insertSubscriber(env.DB, {
      email,
      locale: 'fr-CA',
      consentText: 'wording the site showed',
      consentVersion: 'site-version',
      ip: null,
      userAgent: null,
      source: null,
    })
    const before = await findByEmail(env.DB, email)
    // Force it to unsubscribed the way the real flow would.
    await unsubscribe(env.DB, token)

    const res = await postSignedCustomerEvent(customerEvent({ email }), 'customers/update')
    expect(res.status).toBe(200)

    const after = await findByEmail(env.DB, email)
    expect(after?.status).toBe('unsubscribed')
    expect(after?.consent_text).toBe(before?.consent_text)
    expect(after?.consent_version).toBe(before?.consent_version)
  })

  it('never overwrites an existing confirmed row from the site signup form', async () => {
    const email = uniqueEmail()
    const { token } = await insertSubscriber(env.DB, {
      email,
      locale: 'fr-CA',
      consentText: 'wording the site showed',
      consentVersion: 'site-version',
      ip: null,
      userAgent: null,
      source: null,
    })
    await confirmSubscriber(env.DB, token)

    const res = await postSignedCustomerEvent(customerEvent({ email }), 'customers/update')
    expect(res.status).toBe(200)

    const row = await findByEmail(env.DB, email)
    expect(row?.status).toBe('confirmed')
    expect(row?.consent_text).toBe('wording the site showed')
    expect(row?.consent_version).toBe('site-version')
    expect(row?.source).toBeNull()
  })

  it('returns 200 and inserts nothing for a payload with no email', async () => {
    const event = { locale: 'fr-CA', email_marketing_consent: { state: 'subscribed' } }
    const payload = JSON.stringify(event)
    const signature = await signShopifyPayload(payload, WEBHOOK_SECRET)
    const res = await postWebhook(event, {
      'X-Shopify-Hmac-Sha256': signature,
      'X-Shopify-Topic': 'customers/create',
    })
    expect(res.status).toBe(200)
  })

  it('returns 200 for malformed JSON rather than throwing', async () => {
    const payload = '{not valid json'
    const signature = await signShopifyPayload(payload, WEBHOOK_SECRET)
    const request = new Request('https://nuageathletics.com/api/webhooks/shopify', {
      method: 'POST',
      headers: {
        'X-Shopify-Hmac-Sha256': signature,
        'X-Shopify-Topic': 'customers/create',
      },
      body: payload,
    })
    const res = await POST({ request } as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
  })

  it('rejects a badly signed customers/update event and inserts nothing', async () => {
    const email = uniqueEmail()
    const event = customerEvent({ email })
    const res = await postWebhook(event, {
      'X-Shopify-Hmac-Sha256': 'not-a-real-signature',
      'X-Shopify-Topic': 'customers/update',
    })
    expect(res.status).toBe(401)
    expect(await findByEmail(env.DB, email)).toBeNull()
  })

  it('falls back to now when consent_updated_at is missing or unparseable', async () => {
    const email = uniqueEmail()
    const before = Date.now()
    const res = await postSignedCustomerEvent(
      customerEvent({ email, consentUpdatedAt: 'not-a-date' }),
      'customers/create'
    )
    expect(res.status).toBe(200)
    const after = Date.now()

    const row = await findByEmail(env.DB, email)
    expect(row?.consented_at).toBeGreaterThanOrEqual(before)
    expect(row?.consented_at).toBeLessThanOrEqual(after)
  })

  it('unsubscribes a Shopify-sourced row when consent is later withdrawn', async () => {
    const email = uniqueEmail()
    await postSignedCustomerEvent(customerEvent({ email }), 'customers/create')
    expect((await findByEmail(env.DB, email))?.status).toBe('confirmed')

    const res = await postSignedCustomerEvent(
      customerEvent({ email, state: 'not_subscribed' }),
      'customers/update'
    )
    expect(res.status).toBe(200)

    const row = await findByEmail(env.DB, email)
    expect(row?.status).toBe('unsubscribed')
    expect(row?.unsubscribed_at).not.toBeNull()
    // Consent evidence is never rewritten, even on withdrawal.
    expect(row?.consent_version).toBe(SHOPIFY_CONSENT_VERSION)
  })

  it('does not unsubscribe a site-sourced row when Shopify reports no consent', async () => {
    const email = uniqueEmail()
    const { token } = await insertSubscriber(env.DB, {
      email,
      locale: 'fr-CA',
      consentText: 'wording the site showed',
      consentVersion: 'site-version',
      ip: null,
      userAgent: null,
      source: null,
    })
    await confirmSubscriber(env.DB, token)

    const res = await postSignedCustomerEvent(
      customerEvent({ email, state: 'not_subscribed' }),
      'customers/update'
    )
    expect(res.status).toBe(200)

    const row = await findByEmail(env.DB, email)
    expect(row?.status).toBe('confirmed')
  })
})
