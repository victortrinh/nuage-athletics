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
  label: string // e.g. "M"
  inStock: boolean
}

export interface Product {
  id: string
  slug: string
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

export interface CommerceAdapter {
  readonly name: string
  getProduct(slug: string, locale: Locale): Promise<Product | null>
  createCheckout(input: CheckoutInput): Promise<{ url: string }>
  getOrder(id: string): Promise<Order | null>
}
