import type { Locale } from '../../i18n/config'

/**
 * Everything commerce-related goes through this interface.
 *
 * Phase 1 ships StripeAdapter only. If Lightspeed later earns its place
 * (retail, POS, real inventory), implement LightspeedAdapter and swap the
 * export in ./index.ts. Nothing in src/pages should import Stripe directly.
 */

export interface Money {
  /** minor units, e.g. cents */
  amount: number
  currency: 'CAD'
}

export interface ProductVariant {
  id: string
  sku: string
  label: string // e.g. "Classique · M"
  inStock: boolean
  /**
   * The option axes this variant sits on, as ids never display strings
   * (e.g. { fit: 'crop', size: 'M' }). Generic on purpose: this interface is
   * the contract a Lightspeed adapter must also satisfy, and "fit" is a fact
   * about this garment, not something the commerce contract should hardcode.
   * Optional so a single-axis product needs none.
   */
  options?: Record<string, string>
}

export interface Product {
  id: string
  slug: string
  /** This product's slug in every locale, for hreflang alternates. */
  slugs: Record<Locale, string>
  name: string
  description: string
  price: Money
  images: string[]
  variants: ProductVariant[]
}

export interface CheckoutLine {
  variantId: string
  quantity: number
}

export interface CheckoutInput {
  lines: CheckoutLine[]
  locale: Locale
  successUrl: string
  cancelUrl: string
}

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded'

export interface Order {
  id: string
  status: OrderStatus
  total: Money
  email: string | null
  createdAt: number
}

/**
 * A normalized webhook event, decoupled from any one provider's payload
 * shape or signature scheme. `raw` is kept for auditing but nothing under
 * src/pages should need to read provider-specific fields off it directly.
 */
export interface WebhookEvent {
  orderId: string
  status: OrderStatus
  email: string | null
  locale: Locale
  total: Money
  raw: unknown
}

export interface CommerceAdapter {
  readonly name: string
  getProduct(slug: string, locale: Locale): Promise<Product | null>
  createCheckout(input: CheckoutInput): Promise<{ url: string }>
  getOrder(id: string): Promise<Order | null>
  /**
   * Verifies the webhook signature and, if valid and relevant, normalizes it
   * into a WebhookEvent. Returns null for an invalid signature or an event
   * type this app doesn't act on (e.g. Stripe sends many event types; only
   * checkout completion matters here).
   */
  verifyWebhook(payload: string, signatureHeader: string | null): Promise<WebhookEvent | null>
}
