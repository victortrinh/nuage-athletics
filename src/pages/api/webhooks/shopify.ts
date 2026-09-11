import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resetStorefrontCache, verifyShopifyWebhook } from '../../../lib/commerce/shopify.ts'
import {
  consentFromPayload,
  normalizeEmail,
  type CustomerWebhookPayload,
} from '../../../lib/commerce/shopify-consent.ts'
import { insertShopifySubscriber, withdrawShopifyConsent } from '../../../lib/db.ts'

export const prerender = false

/**
 * Shopify's webhooks, dispatched by X-Shopify-Topic.
 *
 * `orders/paid`: unlike the retired Stripe webhook, this persists nothing —
 * there is no `orders` table any more, and Shopify itself is now the order
 * record and sends its own transactional email (order/shipping/delivery).
 * What it actually does: invalidate the cached price/availability read the
 * moment an order confirms, so a size that just sold out stops reading as
 * available on the very next request instead of for up to CACHE_TTL_MS
 * (~15s). That cache is per-isolate module state, so this is best-effort
 * across isolates, not a guarantee — and it is not the oversell guard either
 * way. `resolveMerchandiseId()` in `src/pages/api/cart.ts` re-reads the
 * variant before adding a line, and Shopify itself refuses to sell a
 * sold-out variant at checkout. This narrows a visible-staleness window; it
 * doesn't need to be perfect to be worth having.
 *
 * `customers/create` / `customers/update`: reconciles a Shopify checkout
 * marketing opt-in into the `subscribers` ledger (issue #35), so
 * scripts/broadcast.ts's recipient list stops missing everyone who opted in
 * at checkout rather than through the site's own signup form.
 *
 * These two topics carry the full customer object, consent state included —
 * `customers/email_marketing_consent/update` looks like the more targeted
 * topic, but its payload is only `{ customer_id, email_marketing_consent }`:
 * no email, no locale. Acting on it would mean an Admin API lookup by
 * customer_id, which drags in a `read_customers` token — a credential that
 * reads every customer's name, address and order history — for a job the
 * fuller `customers/*` payload already does without one. So: no Admin API
 * token anywhere in this codebase, and this route is the entire mechanism.
 * (There is deliberately no backfill for opt-ins that predate this webhook
 * subscription — see the comment on SHOPIFY_CHECKOUT_CONSENT in
 * src/lib/consent.ts.)
 *
 * `customers/update` fires on any edit to a customer, so most events carry no
 * new consent — consentFromPayload's null return and the insert's
 * `ON CONFLICT(email) DO NOTHING` make that the cheap, expected case rather
 * than something to special-case here.
 *
 * Shopify signs with base64 HMAC-SHA256 over the raw body
 * (`X-Shopify-Hmac-Sha256`) — a different scheme from Stripe's hex
 * `t=`/`v1=` header, verified by `verifyShopifyWebhook` in
 * `src/lib/commerce/shopify.ts`. Unlike the Stripe route's `200 ignored` for
 * a bad signature, a missing or invalid one here returns 401: there is no
 * order state to protect from a duplicate write any more, so there is no
 * reason to hide a forged request behind a 200.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!env.SHOPIFY_WEBHOOK_SECRET) {
    return new Response('not configured', { status: 500 })
  }

  const signature = request.headers.get('X-Shopify-Hmac-Sha256')
  const payload = await request.text()

  const valid = await verifyShopifyWebhook(env.SHOPIFY_WEBHOOK_SECRET, payload, signature)
  if (!valid) return new Response('invalid signature', { status: 401 })

  // Shopify's webhook subscriptions are topic-scoped, but this route is
  // registered once per topic and checks the topic itself rather than
  // trusting the subscription config alone to keep other event types out.
  const topic = request.headers.get('X-Shopify-Topic')

  switch (topic) {
    case 'orders/paid':
      resetStorefrontCache()
      return new Response('ok', { status: 200 })

    case 'customers/create':
    case 'customers/update':
      await handleCustomerEvent(payload)
      return new Response('ok', { status: 200 })

    default:
      return new Response('ignored', { status: 200 })
  }
}

/**
 * Always resolves, never throws: a non-2xx response makes Shopify retry an
 * event that would fail identically every time (malformed JSON, no email, no
 * active consent), so every outcome here — including "nothing to do" — is
 * reported as handled and merely logged when it isn't a straightforward
 * insert.
 */
async function handleCustomerEvent(payload: string): Promise<void> {
  let body: CustomerWebhookPayload
  try {
    body = JSON.parse(payload)
  } catch {
    console.error('shopify customer webhook: malformed JSON payload')
    return
  }

  const consent = consentFromPayload(body)
  if (consent) {
    const inserted = await insertShopifySubscriber(env.DB, consent)
    if (!inserted) {
      // Already in the ledger under any status — including unsubscribed,
      // which must stay unsubscribed regardless of what Shopify reports.
      console.log(`shopify customer webhook: ${consent.email} already in subscribers, skipped`)
    }
    return
  }

  // Not an active 'subscribed' state. If we hold a Shopify-sourced row for
  // this email, honour the withdrawal — but never touch a row that came from
  // the site's own signup form; an unrelated Shopify profile edit must not
  // unsubscribe someone who opted in directly with us.
  const email = body.email?.trim()
  if (!email) {
    console.error('shopify customer webhook: payload had no email, skipped')
    return
  }
  await withdrawShopifyConsent(env.DB, normalizeEmail(email))
}
