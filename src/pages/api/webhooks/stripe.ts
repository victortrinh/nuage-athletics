import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { getCommerce } from '../../../lib/commerce/index.ts'
import { sendOrderConfirmationEmail } from '../../../lib/email.ts'

export const prerender = false

/**
 * Stripe retries on any non-2xx response, so a transient DB error here
 * should surface as a 500 (please retry), not swallow the event.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response('not configured', { status: 500 })
  }

  const signatureHeader = request.headers.get('stripe-signature')
  const payload = await request.text()

  const commerce = getCommerce(env)
  const event = await commerce.verifyWebhook(payload, signatureHeader)

  // Invalid signature, or an event type this app doesn't act on — either
  // way, nothing to do. Stripe sends dozens of event types; we only care
  // about checkout completion.
  if (!event) return new Response('ignored', { status: 200 })

  const existing = await env.DB.prepare('SELECT status FROM orders WHERE id = ?')
    .bind(event.orderId)
    .first<{ status: string }>()
  const alreadyPaid = existing?.status === 'paid'

  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO orders (id, status, email, locale, amount_total, currency, raw_event, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       email = excluded.email,
       raw_event = excluded.raw_event,
       updated_at = excluded.updated_at`
  )
    .bind(
      event.orderId,
      event.status,
      event.email,
      event.locale,
      event.total.amount,
      event.total.currency,
      JSON.stringify(event.raw),
      now,
      now
    )
    .run()

  // Only email on the transition into "paid" — a retried webhook for an
  // order we've already confirmed shouldn't double-send the receipt.
  if (!alreadyPaid && event.status === 'paid' && event.email) {
    const sent = await sendOrderConfirmationEmail({
      apiKey: env.RESEND_API_KEY,
      to: event.email,
      locale: event.locale,
      amountTotal: event.total.amount,
      currency: event.total.currency,
    })
    if (!sent.ok) console.error('order confirmation email failed', sent.error)
  }

  return new Response('ok', { status: 200 })
}
