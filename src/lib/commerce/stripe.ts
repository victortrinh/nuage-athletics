import type {
  CheckoutInput,
  CommerceAdapter,
  Order,
  Product,
} from './types'
import type { Locale } from '../../i18n/config'

/**
 * Stripe via REST + fetch rather than the stripe-node SDK: the SDK needs a
 * custom HTTP client to run on Workers, and we use three endpoints.
 *
 * Catalogue is local for now — one SKU does not justify a product API round
 * trip. Move it behind Stripe Products (or Lightspeed) when there is a second
 * product or someone non-technical needs to edit it.
 */

const API = 'https://api.stripe.com/v1'

const CATALOGUE: Record<Locale, Product[]> = {
  'fr-CA': [
    {
      id: 'tee-01',
      slug: 'chandail-01',
      name: 'Chandail 01',
      description: 'À venir.',
      price: { amount: 6500, currency: 'CAD' },
      images: [],
      variants: [
        { id: 'tee-01-s', sku: 'NA-TEE01-S', label: 'S', inStock: true },
        { id: 'tee-01-m', sku: 'NA-TEE01-M', label: 'M', inStock: true },
        { id: 'tee-01-l', sku: 'NA-TEE01-L', label: 'L', inStock: true },
        { id: 'tee-01-xl', sku: 'NA-TEE01-XL', label: 'XL', inStock: true },
      ],
    },
  ],
  'en-CA': [
    {
      id: 'tee-01',
      slug: 'tee-01',
      name: 'Tee 01',
      description: 'Coming soon.',
      price: { amount: 6500, currency: 'CAD' },
      images: [],
      variants: [
        { id: 'tee-01-s', sku: 'NA-TEE01-S', label: 'S', inStock: true },
        { id: 'tee-01-m', sku: 'NA-TEE01-M', label: 'M', inStock: true },
        { id: 'tee-01-l', sku: 'NA-TEE01-L', label: 'L', inStock: true },
        { id: 'tee-01-xl', sku: 'NA-TEE01-XL', label: 'XL', inStock: true },
      ],
    },
  ],
}

function form(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
}

export function createStripeAdapter(secretKey: string): CommerceAdapter {
  async function call<T>(path: string, body?: string): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!res.ok) throw new Error(`stripe ${res.status}: ${await res.text()}`)
    return (await res.json()) as T
  }

  return {
    name: 'stripe',

    async getProduct(slug, locale) {
      return CATALOGUE[locale].find((p) => p.slug === slug) ?? null
    },

    async createCheckout(input: CheckoutInput) {
      const products = CATALOGUE[input.locale]
      const params: Record<string, string | number> = {
        mode: 'payment',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        locale: input.locale === 'fr-CA' ? 'fr-CA' : 'en',
        // Canada-wide only. Stripe cannot restrict by province; do that in the
        // webhook or a pre-checkout check if it ever becomes QC-only.
        'shipping_address_collection[allowed_countries][0]': 'CA',
        // Stripe Tax computes GST/HST/QST. It only charges for the
        // registrations you have actually configured in the dashboard.
        'automatic_tax[enabled]': 'true',
      }

      input.lines.forEach((line, i) => {
        const product = products.find((p) =>
          p.variants.some((v) => v.id === line.variantId)
        )
        const variant = product?.variants.find((v) => v.id === line.variantId)
        if (!product || !variant) throw new Error(`unknown variant ${line.variantId}`)

        params[`line_items[${i}][quantity]`] = line.quantity
        params[`line_items[${i}][price_data][currency]`] = product.price.currency.toLowerCase()
        params[`line_items[${i}][price_data][unit_amount]`] = product.price.amount
        params[`line_items[${i}][price_data][product_data][name]`] =
          `${product.name} — ${variant.label}`
        params[`line_items[${i}][price_data][tax_behavior]`] = 'exclusive'
      })

      const session = await call<{ url: string }>('/checkout/sessions', form(params))
      return { url: session.url }
    },

    async getOrder(id): Promise<Order | null> {
      const s = await call<{
        id: string
        payment_status: string
        amount_total: number
        currency: string
        customer_details?: { email?: string }
        created: number
      }>(`/checkout/sessions/${id}`)

      return {
        id: s.id,
        status: s.payment_status === 'paid' ? 'paid' : 'pending',
        total: { amount: s.amount_total, currency: 'CAD' },
        email: s.customer_details?.email ?? null,
        createdAt: s.created * 1000,
      }
    },
  }
}
