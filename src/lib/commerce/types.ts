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
  /**
   * The provider's own id for this exact variant — a Shopify variant GID,
   * opaque to everything outside `./shopify.ts`. `catalogue.ts`'s own `id`
   * (`ls-01-classic-m`) is this site's stable identifier for the variant and
   * is never enough on its own to add a line to a cart: Shopify's cart
   * mutations take its GID, not ours. Optional and absent whenever the
   * catalogue has no live join for this SKU — see `getLiveProduct`.
   */
  merchandiseId?: string
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

/** One line in a cart — a variant, the quantity of it, and what that quantity costs. */
export interface CartLine {
  id: string
  merchandiseId: string
  /**
   * The catalogue's own join key — `''` when Shopify's variant carries none.
   * `CartView.astro` uses it to look the line back up in `catalogue.ts` for a
   * thumbnail, fit and size; a line that doesn't join still renders from
   * `label`/`unitPrice`/`linePrice` alone. See non-negotiable 5.5: this is a
   * lookup key, not a price, so there is no failure mode here for that rule
   * to guard against.
   */
  sku: string
  label: string
  quantity: number
  unitPrice: Money
  linePrice: Money
}

export interface Cart {
  id: string
  lines: CartLine[]
  subtotal: Money
  /**
   * Shopify's own grand total (`cost.totalAmount`) — rendered as-is, never
   * computed from `subtotal` here, so a store that later adds shipping or
   * tax can't silently disagree with what this page shows. Today, with
   * neither configured, it equals `subtotal`.
   */
  total: Money
  /**
   * `null` when Shopify has no tax registration to quote from yet (true for
   * the first drop) — distinct from a real $0 so the render can say
   * "calculated at checkout" instead of a number that would otherwise read
   * as a considered answer. See non-negotiable 5.5's reasoning: an
   * advertised total is one a Quebec merchant is expected to honour, and a
   * silently-omitted tax is not an honest total.
   */
  tax: Money | null
  /** Shopify's hosted checkout for this cart — where "Buy" hands off to. */
  checkoutUrl: string
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
