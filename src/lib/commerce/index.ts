import type { Locale } from '../../i18n/config'
import { previewActive } from '../preview'
import { createShopifyStorefront, StorefrontError } from './shopify'
import type { Cart, Product } from './types'

export type * from './types'

interface StorefrontEnv {
  SHOPIFY_STORE_DOMAIN?: string
  SHOPIFY_STOREFRONT_TOKEN?: string
}

/**
 * The product as it is actually for sale right now — catalogue copy with
 * Shopify's price and per-variant availability joined onto it — or null.
 *
 * A null product is the whole failure mode, and it is deliberately the *only*
 * one. A Storefront outage, an unconfigured store, a SKU that doesn't join:
 * each returns null, the page renders the state it already has for "there is
 * nothing to buy yet" (no price, no buy band — see ProductView.astro), and
 * nobody is shown a number that might be wrong. The alternatives are a stale
 * price and a 500, and both are worse than a page that quietly declines to
 * sell for a minute.
 *
 * `reason` exists because that design has one cost: from the outside, a store
 * that was never wired up is indistinguishable from a drop that hasn't opened.
 * It changes nothing about the render — the pages put it on a response header
 * (`X-Storefront`) so someone who can already see the page can see why there
 * is no price on it, without the page itself differing from launch day.
 * `npx wrangler secret list` answers the two `no-*` cases from the CLI.
 *
 * Pages call this rather than reaching for `./shopify` themselves, so the
 * provider stays swappable from this file alone (CLAUDE.md non-negotiable 5).
 */
export type StorefrontReason =
  /** A price came back. */
  | 'ok'
  /** `SHOPIFY_STORE_DOMAIN` is unset on the Worker serving this request. */
  | 'no-domain'
  /** `SHOPIFY_STOREFRONT_TOKEN` is unset on the Worker serving this request. */
  | 'no-token'
  /** The call threw, answered non-2xx, or came back with GraphQL errors. */
  | 'unreachable'
  /** The store answered, and none of this product's SKUs were in it. */
  | 'no-match'

export interface LiveProduct {
  product: Product | null
  reason: StorefrontReason
  /**
   * What kind of `unreachable` — `status=401`, `graphql`, `network`. A
   * refused token and a wrong domain are the same category and different
   * fixes, and this is the difference between them without reading a log.
   */
  detail?: string
}

/**
 * The env check `getLiveProduct` and every cart operation below share: which
 * of the two Shopify bindings is missing, said out loud, once, rather than
 * five call sites each re-deriving "no-domain" vs "no-token".
 */
function resolveStorefront(
  env: StorefrontEnv
): { domain: string; token: string } | { reason: 'no-domain' | 'no-token' } {
  const domain = env.SHOPIFY_STORE_DOMAIN
  // A secret is pasted by hand, and a paste picks things up: a trailing
  // newline from `echo | wrangler secret put`, or the quotes someone put
  // around it. Shopify answers a token with either on it exactly as it
  // answers a wrong one — 401 — so this is one more thing that looks like a
  // credential problem and isn't. (`normalizeDomain` does the same for the
  // domain.)
  const token = env.SHOPIFY_STOREFRONT_TOKEN?.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (domain && token) return { domain, token }

  // Said out loud for the same reason the no-join case in ./shopify.ts is:
  // an unconfigured store renders exactly like a pre-drop page, so without
  // this the only symptom is a buy band that never appears.
  //
  // Which of the two is missing is worth a distinct answer rather than one
  // "not configured": the two have different causes. A missing token is
  // usually a name that doesn't match what was set; a missing domain is
  // usually a secret that landed on a different Worker, or a version
  // uploaded before it was added.
  const missing = !domain ? 'SHOPIFY_STORE_DOMAIN' : 'SHOPIFY_STOREFRONT_TOKEN'
  console.error(`storefront: ${missing} is unset — no price will render`)
  return { reason: !domain ? 'no-domain' : 'no-token' }
}

export async function getLiveProduct(
  env: StorefrontEnv,
  slug: string,
  locale: Locale
): Promise<LiveProduct> {
  const config = resolveStorefront(env)
  if (!('domain' in config)) return { product: null, reason: config.reason }

  try {
    const product = await createShopifyStorefront(config).getProduct(slug, locale)
    return { product, reason: product ? 'ok' : 'no-match' }
  } catch (err) {
    console.error('storefront read failed', err)
    return {
      product: null,
      reason: 'unreachable',
      // Anything that isn't a refusal we recognise never left the machine:
      // DNS, TLS, a domain that doesn't resolve.
      detail: err instanceof StorefrontError ? err.detail : 'network',
    }
  }
}

export interface LiveCart {
  cart: Cart | null
  reason: StorefrontReason
  detail?: string
}

/**
 * One cart mutation, run against whichever Shopify operation `run` performs.
 * Every cart route (`src/pages/api/cart.ts`) goes through this — never
 * `./shopify` directly — for the same reason `getLiveProduct` is the seam
 * for reads: one place resolves the env, one place turns a thrown
 * `StorefrontError` into the same `StorefrontReason` vocabulary the page
 * layer already knows how to render.
 */
async function withStorefront(
  env: StorefrontEnv,
  run: (source: ReturnType<typeof createShopifyStorefront>) => Promise<Cart | null>
): Promise<LiveCart> {
  const config = resolveStorefront(env)
  if (!('domain' in config)) return { cart: null, reason: config.reason }

  try {
    const cart = await run(createShopifyStorefront(config))
    // A null cart here means Shopify no longer knows the id (expired, or
    // already turned into an order) — not a failure, just an empty cart.
    return { cart, reason: 'ok' }
  } catch (err) {
    console.error('storefront cart operation failed', err)
    return {
      cart: null,
      reason: 'unreachable',
      detail: err instanceof StorefrontError ? err.detail : 'network',
    }
  }
}

/** The cart as it stands right now. Never cached — unlike `getLiveProduct`, this is one visitor's. */
export function readCart(env: StorefrontEnv, cartId: string): Promise<LiveCart> {
  return withStorefront(env, (source) => source.getCart(cartId))
}

export type CartOp =
  | { intent: 'add'; cartId: string | null; merchandiseId: string; quantity: number }
  | { intent: 'update'; cartId: string; lineId: string; quantity: number }
  | { intent: 'remove'; cartId: string; lineId: string }

/** Create, add, update or remove — whichever `op.intent` names. */
export function mutateCart(env: StorefrontEnv, op: CartOp): Promise<LiveCart> {
  return withStorefront(env, (source) => {
    switch (op.intent) {
      case 'add':
        return op.cartId
          ? source.addLine(op.cartId, op.merchandiseId, op.quantity)
          : source.createCart(op.merchandiseId, op.quantity)
      case 'update':
        return source.updateLine(op.cartId, op.lineId, op.quantity)
      case 'remove':
        return source.removeLine(op.cartId, op.lineId)
    }
  })
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
