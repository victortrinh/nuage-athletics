import { createStripeAdapter } from './stripe'
import type { CommerceAdapter } from './types'

export type * from './types'

/**
 * Single place where the backend is chosen. To move to Lightspeed later,
 * implement LightspeedAdapter with the same interface and change this function.
 */
export function getCommerce(env: {
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
}): CommerceAdapter {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return createStripeAdapter(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET)
}

/**
 * Commerce routes are unlinked from the rest of the site, but a launch date
 * that's still just "fall 2026" text on the homepage isn't a strong enough
 * guarantee on its own — this flag makes /produit/*, /en/product/* and
 * /api/checkout 404 outright until it's flipped to "true" in wrangler.toml.
 */
export function commerceEnabled(env: { COMMERCE_ENABLED?: string }): boolean {
  return env.COMMERCE_ENABLED === 'true'
}
