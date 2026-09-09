import { previewActive } from '../preview'
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
