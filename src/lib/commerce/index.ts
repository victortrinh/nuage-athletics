import type { Locale } from '../../i18n/config'
import { previewActive } from '../preview'
import { createShopifyStorefront } from './shopify'
import { createStripeAdapter } from './stripe'
import type { CommerceAdapter, Product } from './types'

export type * from './types'

interface StorefrontEnv {
  SHOPIFY_STORE_DOMAIN?: string
  SHOPIFY_STOREFRONT_TOKEN?: string
}

/**
 * The product as it is actually for sale right now — catalogue copy with
 * Shopify's price and per-variant availability joined onto it — or null.
 *
 * Null is the whole failure mode, and it is deliberately the *only* one. A
 * Storefront outage, an unconfigured store, a SKU that doesn't join: each
 * returns null, the page renders the state it already has for "there is
 * nothing to buy yet" (no price, no buy band — see ProductView.astro), and
 * nobody is shown a number that might be wrong. The alternatives are a stale
 * price and a 500, and both are worse than a page that quietly declines to
 * sell for a minute.
 *
 * Pages call this rather than reaching for `./shopify` themselves, so the
 * provider stays swappable from this file alone (CLAUDE.md non-negotiable 5).
 */
export async function getLiveProduct(
  env: StorefrontEnv,
  slug: string,
  locale: Locale
): Promise<Product | null> {
  const domain = env.SHOPIFY_STORE_DOMAIN
  const token = env.SHOPIFY_STOREFRONT_TOKEN
  if (!domain || !token) return null

  try {
    return await createShopifyStorefront({ domain, token }).getProduct(slug, locale)
  } catch (err) {
    console.error('storefront read failed', err)
    return null
  }
}

/**
 * Single place where the backend is chosen. To move to Lightspeed later,
 * implement LightspeedAdapter with the same interface and change this function.
 */
export function getCommerce(
  env: StorefrontEnv & {
    STRIPE_SECRET_KEY?: string
    STRIPE_WEBHOOK_SECRET?: string
  }
): CommerceAdapter {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  // Stripe still takes the payment; it no longer decides what to charge.
  // The line item is priced from the same `getLiveProduct` read the page
  // rendered from, so "the price you saw is the price you pay" holds by
  // construction rather than by two files agreeing on a constant.
  return createStripeAdapter(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET, (slug, locale) =>
    getLiveProduct(env, slug, locale)
  )
}

/**
 * May this request see prices and the buy flow?
 *
 * Two ways to answer yes, and both are interpreted here rather than at the
 * call sites, so there is one file to read to know what turns commerce on.
 *
 * `COMMERCE_ENABLED` is the public switch: off until the drop, at which point
 * everyone gets the buy flow. Preview is the per-visitor one — a founder
 * carrying the cookie from src/middleware.ts sees the real fit and size
 * pickers, the real price and the real buy button while the public still sees
 * the drop announcement. That is the whole point of it: the buy flow has to be
 * testable on the real site before it opens, and the alternative was a
 * password wall over the entire site.
 *
 * Because the answer now varies per visitor and it gates a *price*, a preview
 * render must never end up in a shared cache — see the Cache-Control note in
 * src/middleware.ts.
 */
export async function commerceEnabled(
  env: { COMMERCE_ENABLED?: string; PREVIEW_PASSWORD?: string },
  cookies: string | null = null
): Promise<boolean> {
  if (env.COMMERCE_ENABLED === 'true') return true
  return previewActive(env, cookies)
}
