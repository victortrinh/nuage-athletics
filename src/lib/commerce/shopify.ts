import type { Locale } from '../../i18n/config'
// Explicit extension: scripts/shopify-check.ts imports this file under plain
// node, which resolves nothing for you.
import { getCatalogueProduct } from '../catalogue.ts'
import type { Money, Product, ProductVariant } from './types'

/**
 * Shopify Storefront API, read side.
 *
 * This is the *only* source of a customer-visible price. `catalogue.ts` holds
 * the copy — name, description, photography, alt text, the SKUs — and carries
 * no price at all any more (`PLACEHOLDER_PRICE_CENTS` is gone). The two are
 * joined here by SKU, which is why the size rename had to land before Shopify
 * inventory was loaded: the SKU is the join key.
 *
 * Raw `fetch` against GraphQL rather than `@shopify/storefront-api-client`,
 * for the same reason `stripe.ts` skips the Stripe SDK: it would need a custom
 * HTTP client to run on Workers, and this file uses one query.
 */

/**
 * Shopify ships a new stable Storefront API version quarterly and supports
 * each for twelve months. Bump this deliberately (and re-read the query
 * below against the changelog) rather than tracking `unstable`.
 */
const API_VERSION = '2026-01'

/**
 * How long a price/availability read is reused.
 *
 * Fifteen seconds because a drop-day size can sell out in minutes: long
 * enough that a traffic spike doesn't put a Storefront call on every page
 * view, short enough that "Épuisé" appears while it still means something.
 * The window is per isolate, so the real staleness a visitor sees is at most
 * this, not this times the number of Workers isolates.
 */
const CACHE_TTL_MS = 15_000

/** Bounded on purpose — see the note on `INVENTORY_QUERY`. */
const MAX_PRODUCTS = 10
const MAX_VARIANTS = 100

/**
 * Every variant of every product, joined locally by SKU.
 *
 * The Storefront API cannot filter or look a variant up *by* SKU (only the
 * Admin API can), and this site's slugs are per-locale — `handle` would need
 * a third mapping to maintain, in a file whose whole point is that there is
 * one place a price comes from. With one product and fourteen variants the
 * whole catalogue is one small query, so it fetches the lot and joins here.
 * If a second product ever pushes past MAX_PRODUCTS, this is the thing to
 * revisit: paginate, or carry a handle per catalogue entry.
 */
const INVENTORY_QUERY = `query NuageInventory($products: Int!, $variants: Int!) {
  products(first: $products) {
    nodes {
      variants(first: $variants) {
        nodes {
          sku
          availableForSale
          price { amount currencyCode }
        }
      }
    }
  }
}`

interface InventoryResponse {
  data?: {
    products?: {
      nodes?: {
        variants?: {
          nodes?: {
            sku?: string | null
            availableForSale?: boolean
            price?: { amount?: string; currencyCode?: string }
          }[]
        }
      }[]
    }
  }
  errors?: { message?: string }[]
}

/**
 * A refusal, carrying the status that says which refusal it was.
 *
 * 401/403 is the token (wrong store, wrong kind of token, missing scope),
 * 404 is the domain or an API version that no longer exists, 402/423 is the
 * store itself being frozen or locked, and a GraphQL error at 200 is usually
 * a field the token may not read. Those are four different fixes, so the
 * status travels with the failure instead of being flattened into "the
 * Storefront call failed" at the point where someone reads it.
 */
export class StorefrontError extends Error {
  constructor(
    message: string,
    readonly detail: string
  ) {
    super(message)
    this.name = 'StorefrontError'
  }
}

/** What Shopify knows about one SKU. */
interface LiveVariant {
  price: Money
  available: boolean
}

type Inventory = Map<string, LiveVariant>

export interface StorefrontConfig {
  /** e.g. `nuage-athletics.myshopify.com` — host only, no scheme. */
  domain: string
  token: string
}

/**
 * `http` for a loopback host so the e2e suite can point this at its own stub
 * Storefront server (see `e2e/storefront-stub.ts`) and exercise this file for
 * real — the sold-out and outage assertions there run through this code, not
 * around it. Everything else is https, unconditionally: the token is a
 * bearer credential.
 */
function endpoint(domain: string): string {
  const host = normalizeDomain(domain)
  const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  return `${loopback ? 'http' : 'https'}://${host}/api/${API_VERSION}/graphql.json`
}

/**
 * `SHOPIFY_STORE_DOMAIN` is a host — "nuage-athletics.myshopify.com" — but it
 * is set by hand as a secret, and pasting the URL it came from is the obvious
 * slip. Left alone that builds `https://https://…`, which fails open like any
 * other outage: silently, for fifteen seconds at a time, with no price. Take
 * the host out of whatever was pasted instead.
 */
export function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
}

/**
 * "65.00" → 6500, without going through a float that can land on 6499.
 * Shopify returns a decimal string; anything that isn't one is refused
 * rather than rounded into something plausible.
 */
export function parsePriceToCents(amount: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim())
  if (!match) return null
  const [, whole, fraction = ''] = match
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

/** In-flight and recently-fetched inventory, keyed by store domain. */
const cache = new Map<string, { expires: number; inventory: Inventory }>()
const inFlight = new Map<string, Promise<Inventory>>()

async function fetchInventory(config: StorefrontConfig): Promise<Inventory> {
  const res = await fetch(endpoint(config.domain), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': config.token,
    },
    body: JSON.stringify({
      query: INVENTORY_QUERY,
      variables: { products: MAX_PRODUCTS, variants: MAX_VARIANTS },
    }),
  })
  if (!res.ok) {
    throw new StorefrontError(
      `shopify storefront ${res.status}: ${await res.text()}`,
      `status=${res.status}`
    )
  }

  const body = (await res.json()) as InventoryResponse
  // GraphQL answers 200 with an `errors` array. Treating that as success is
  // how a partial response turns into a missing price rendered as a real one.
  if (body.errors?.length) {
    throw new StorefrontError(
      `shopify storefront: ${body.errors.map((e) => e.message).join('; ')}`,
      'graphql'
    )
  }

  const inventory: Inventory = new Map()
  for (const product of body.data?.products?.nodes ?? []) {
    for (const variant of product.variants?.nodes ?? []) {
      const sku = variant.sku?.trim()
      if (!sku) continue
      const cents = parsePriceToCents(variant.price?.amount ?? '')
      // A price this file can't read, or one in a currency the site doesn't
      // sell in, is not a price — the variant is simply left unknown, which
      // reads downstream as "not sellable" rather than as a number.
      if (cents === null || variant.price?.currencyCode !== 'CAD') continue
      inventory.set(sku, {
        price: { amount: cents, currency: 'CAD' },
        available: variant.availableForSale === true,
      })
    }
  }
  return inventory
}

async function inventoryFor(config: StorefrontConfig): Promise<Inventory> {
  const key = config.domain
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.inventory

  // One read per window even under a drop-day burst: concurrent callers wait
  // on the same promise instead of each opening their own Storefront call.
  const existing = inFlight.get(key)
  if (existing) return existing

  const pending = fetchInventory(config)
    .then((inventory) => {
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS, inventory })
      return inventory
    })
    .finally(() => {
      // Failures are deliberately not cached: a page render that failed open
      // to the no-price state should recover on the next request, not stay
      // wrong for the rest of the window. The in-flight entry above is what
      // keeps a persistent outage from fanning out one call per view.
      inFlight.delete(key)
    })

  inFlight.set(key, pending)
  return pending
}

/** Test seam — the module-level cache outlives a single test otherwise. */
export function resetStorefrontCache(): void {
  cache.clear()
  inFlight.clear()
}

export interface StorefrontSource {
  readonly name: string
  /**
   * The catalogue product for `slug`, priced from Shopify, or null when
   * Shopify can't answer for it. Never throws for an unreachable store: the
   * caller renders the no-price state instead (see `getLiveProduct` in
   * ./index.ts).
   *
   * Later tickets widen this into the full `CommerceAdapter` — cart, checkout
   * handoff and the order webhook all land on the same object.
   */
  getProduct(slug: string, locale: Locale): Promise<Product | null>
}

export function createShopifyStorefront(config: StorefrontConfig): StorefrontSource {
  return {
    name: 'shopify',

    async getProduct(slug, locale): Promise<Product | null> {
      const copy = getCatalogueProduct(slug, locale)
      if (!copy) return null

      const inventory = await inventoryFor(config)

      const variants: ProductVariant[] = copy.variants.map((variant) => ({
        ...variant,
        // A SKU Shopify has never heard of cannot be sold, so it renders
        // disabled rather than blocking the whole product — a half-loaded
        // Shopify catalogue should still sell the sizes that are in it.
        inStock: inventory.get(variant.sku)?.available === true,
      }))

      const prices = copy.variants
        .map((variant) => inventory.get(variant.sku)?.price.amount)
        .filter((amount): amount is number => amount !== undefined)

      // Nothing joined: the store is up but doesn't carry this product yet
      // (or the SKUs drifted, or the products aren't published to the sales
      // channel this token reads). Fail open — no price, no buy panel —
      // rather than render a product page with a blank price.
      //
      // Logged, because this is the one failure that looks identical to
      // "commerce is simply off" from the outside: the page renders exactly
      // as it did the week before and nothing says why. Names the SKUs asked
      // for and how many the store answered with, which is enough to tell an
      // empty sales channel from a SKU typo. `npm run shopify:check` runs the
      // same join outside the Worker and prints the same answer.
      if (prices.length === 0) {
        console.error(
          `storefront: no SKU of ${copy.id} matched the store — ` +
            `looked for ${copy.variants.map((v) => v.sku).join(', ')}; ` +
            `the store returned ${inventory.size} priced CAD variant(s)`
        )
        return null
      }

      // One `Product`, one price. Per-variant pricing would need the band to
      // reprice as the size changes, which it isn't built to do, so a store
      // that prices XXL differently is refused rather than quoted at the
      // wrong number for one of them.
      if (prices.some((amount) => amount !== prices[0])) {
        throw new StorefrontError(
          `shopify storefront: variants of ${copy.id} disagree on price`,
          'price-disagreement'
        )
      }

      return { ...copy, price: { amount: prices[0], currency: 'CAD' }, variants }
    },
  }
}
