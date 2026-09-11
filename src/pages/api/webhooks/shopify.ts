import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resetStorefrontCache, verifyShopifyWebhook } from '../../../lib/commerce/shopify.ts'

export const prerender = false

/**
 * Shopify's order-paid notification. Unlike the retired Stripe webhook, this
 * route persists nothing — there is no `orders` table any more, and Shopify
 * itself is now the order record and sends its own transactional email
 * (order/shipping/delivery). Reconciling checkout marketing opt-ins into the
 * subscriber ledger is a separate, offline job (`scripts/import-shopify-customers.ts`,
 * see issue #35) rather than something this webhook does inline.
 *
 * What this route actually does: invalidate the cached price/availability
 * read the moment an order confirms, so a size that just sold out stops
 * reading as available on the very next request instead of for up to
 * CACHE_TTL_MS (~15s). That cache is per-isolate module state, so this is
 * best-effort across isolates, not a guarantee — and it is not the oversell
 * guard either way. `resolveMerchandiseId()` in `src/pages/api/cart.ts`
 * re-reads the variant before adding a line, and Shopify itself refuses to
 * sell a sold-out variant at checkout. This narrows a visible-staleness
 * window; it doesn't need to be perfect to be worth having.
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
  // registered once and checks the topic itself rather than trusting the
  // subscription config alone to keep other event types out.
  const topic = request.headers.get('X-Shopify-Topic')
  if (topic !== 'orders/paid') return new Response('ignored', { status: 200 })

  resetStorefrontCache()
  return new Response('ok', { status: 200 })
}
