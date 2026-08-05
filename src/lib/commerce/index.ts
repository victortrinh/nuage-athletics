import { createStripeAdapter } from './stripe'
import type { CommerceAdapter } from './types'

export type * from './types'

/**
 * Single place where the backend is chosen. To move to Lightspeed later,
 * implement LightspeedAdapter with the same interface and change this function.
 */
export function getCommerce(env: { STRIPE_SECRET_KEY?: string }): CommerceAdapter {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return createStripeAdapter(env.STRIPE_SECRET_KEY)
}
