import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { POST } from '../src/pages/api/webhooks/stripe'

const WEBHOOK_SECRET = 'whsec_test_not_a_real_secret'

async function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`))
  const hex = [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `t=${timestamp},v1=${hex}`
}

let seq = 0
function checkoutCompletedEvent(overrides: Record<string, unknown> = {}) {
  seq += 1
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${Date.now()}_${seq}`,
        payment_status: 'paid',
        amount_total: 6500,
        currency: 'cad',
        customer_details: { email: `buyer-${seq}@example.com` },
        metadata: { locale: 'fr-CA' },
        ...overrides,
      },
    },
  }
}

async function postWebhook(body: unknown, signature?: string) {
  const payload = JSON.stringify(body)
  const request = new Request('https://nuageathletics.com/api/webhooks/stripe', {
    method: 'POST',
    headers: signature ? { 'stripe-signature': signature } : {},
    body: payload,
  })
  return POST({ request } as Parameters<typeof POST>[0])
}

describe('POST /api/webhooks/stripe', () => {
  it('persists an order on a validly signed checkout.session.completed', async () => {
    const event = checkoutCompletedEvent()
    const payload = JSON.stringify(event)
    const signature = await signStripePayload(payload, WEBHOOK_SECRET)

    const res = await postWebhook(event, signature)
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
      .bind(event.data.object.id)
      .first<{ status: string; email: string; amount_total: number; locale: string }>()
    expect(row?.status).toBe('paid')
    expect(row?.email).toBe(event.data.object.customer_details.email)
    expect(row?.amount_total).toBe(6500)
    expect(row?.locale).toBe('fr-CA')
  })

  it('ignores an invalid signature and does not persist anything', async () => {
    const event = checkoutCompletedEvent()
    const res = await postWebhook(event, 't=123,v1=0000deadbeef')
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
      .bind(event.data.object.id)
      .first()
    expect(row).toBeNull()
  })

  it('ignores a request with no signature header', async () => {
    const event = checkoutCompletedEvent()
    const res = await postWebhook(event)
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
      .bind(event.data.object.id)
      .first()
    expect(row).toBeNull()
  })

  it('upserts instead of duplicating on a retried delivery of the same event', async () => {
    const event = checkoutCompletedEvent()
    const payload = JSON.stringify(event)
    const signature = await signStripePayload(payload, WEBHOOK_SECRET)

    await postWebhook(event, signature)
    const res2 = await postWebhook(event, await signStripePayload(payload, WEBHOOK_SECRET))
    expect(res2.status).toBe(200)

    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE id = ?')
      .bind(event.data.object.id)
      .first<{ n: number }>()
    expect(rows?.n).toBe(1)
  })

  it('ignores event types other than checkout.session.completed', async () => {
    const event = checkoutCompletedEvent()
    event.type = 'payment_intent.created'
    const payload = JSON.stringify(event)
    const signature = await signStripePayload(payload, WEBHOOK_SECRET)

    const res = await postWebhook(event, signature)
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
      .bind(event.data.object.id)
      .first()
    expect(row).toBeNull()
  })
})
