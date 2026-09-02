import type {
  CheckoutInput,
  CommerceAdapter,
  Order,
  WebhookEvent,
} from './types'
import type { Locale } from '../../i18n/config'
import { isLocale, DEFAULT_LOCALE } from '../../i18n/config'
import { CATALOGUE, getCatalogueProduct } from '../catalogue'
import { hmacHex, timingSafeEqual } from '../crypto'

/**
 * Stripe via REST + fetch rather than the stripe-node SDK: the SDK needs a
 * custom HTTP client to run on Workers, and we use three endpoints.
 *
 * The catalogue is local and lives in src/lib/catalogue.ts — one SKU does not
 * justify a product API round trip, and the site has to render the product
 * while Stripe is still switched off. Move it behind Stripe Products (or
 * Lightspeed) when there is a second product or someone non-technical needs to
 * edit it.
 */

const API = 'https://api.stripe.com/v1'

// Placeholders — Victor hasn't given real numbers yet. Adjust here; nothing
// else needs to change.
const FLAT_SHIPPING_CENTS = 1200 // $12.00 CAD
const FREE_SHIPPING_THRESHOLD_CENTS = 15000 // $150.00 CAD

function form(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
}

// Stripe's webhook signature scheme: header is "t=<timestamp>,v1=<hex hmac>"
// (possibly with more v1= entries during secret rotation). The signed
// payload is "<timestamp>.<raw body>", HMAC-SHA256'd with the webhook
// secret. Verified with Web Crypto since the stripe-node SDK isn't usable on
// Workers — same reasoning as the rest of this file.
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60

async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string
): Promise<boolean> {
  const parts = new Map(
    header.split(',').map((p) => {
      const [k, v] = p.split('=')
      return [k, v] as [string, string]
    })
  )
  const timestamp = parts.get('t')
  const signature = parts.get('v1')
  if (!timestamp || !signature) return false

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false

  const expectedHex = await hmacHex(secret, `${timestamp}.${payload}`)
  return timingSafeEqual(expectedHex, signature)
}

export function createStripeAdapter(secretKey: string, webhookSecret?: string): CommerceAdapter {
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
      return getCatalogueProduct(slug, locale)
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
        // Stripe Tax computes GST/HST/QST/PST automatically, but only for
        // registrations actually configured in the dashboard — and none are
        // yet. Leave this off until Victor confirms which registrations
        // exist; enabling it speculatively risks charging tax nobody's
        // registered to collect. See CLAUDE.md 3.5.
        'automatic_tax[enabled]': 'false',
        // Stripe's own `locale` param controls the Checkout page's language,
        // not what we get back in the webhook. Metadata is the reliable way
        // to recover which locale to send the order confirmation in.
        'metadata[locale]': input.locale,
      }

      let subtotal = 0
      input.lines.forEach((line, i) => {
        const product = products.find((p) =>
          p.variants.some((v) => v.id === line.variantId)
        )
        const variant = product?.variants.find((v) => v.id === line.variantId)
        if (!product || !variant) throw new Error(`unknown variant ${line.variantId}`)

        subtotal += product.price.amount * line.quantity
        params[`line_items[${i}][quantity]`] = line.quantity
        params[`line_items[${i}][price_data][currency]`] = product.price.currency.toLowerCase()
        params[`line_items[${i}][price_data][unit_amount]`] = product.price.amount
        params[`line_items[${i}][price_data][product_data][name]`] =
          `${product.name} (${variant.label})`
        params[`line_items[${i}][price_data][tax_behavior]`] = 'exclusive'
      })

      // Flat national rate, free above a threshold — no calculated/carrier
      // rates. Computed here rather than as two Checkout shipping_options
      // because Checkout can't conditionally offer options by cart total.
      const shippingAmount = subtotal >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS
      params['shipping_options[0][shipping_rate_data][type]'] = 'fixed_amount'
      params['shipping_options[0][shipping_rate_data][fixed_amount][amount]'] = shippingAmount
      params['shipping_options[0][shipping_rate_data][fixed_amount][currency]'] = 'cad'
      params['shipping_options[0][shipping_rate_data][display_name]'] =
        shippingAmount === 0 ? 'Livraison gratuite / Free shipping' : 'Livraison / Shipping'

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

    async verifyWebhook(payload, signatureHeader): Promise<WebhookEvent | null> {
      if (!webhookSecret || !signatureHeader) return null
      if (!(await verifyStripeSignature(payload, signatureHeader, webhookSecret))) return null

      const event = JSON.parse(payload) as {
        type: string
        data: {
          object: {
            id: string
            payment_status?: string
            amount_total: number
            currency: string
            customer_details?: { email?: string }
            metadata?: { locale?: string }
          }
        }
      }

      if (event.type !== 'checkout.session.completed') return null

      const session = event.data.object
      const metaLocale = session.metadata?.locale ?? ''
      const locale: Locale = isLocale(metaLocale) ? metaLocale : DEFAULT_LOCALE

      return {
        orderId: session.id,
        status: session.payment_status === 'paid' ? 'paid' : 'pending',
        email: session.customer_details?.email ?? null,
        locale,
        total: { amount: session.amount_total, currency: 'CAD' },
        raw: event,
      }
    },
  }
}
