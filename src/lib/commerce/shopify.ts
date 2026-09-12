import type { Locale } from '../../i18n/config'
// Explicit extension: scripts/shopify-check.ts imports this file under plain
// node, which resolves nothing for you.
import { getCatalogueProduct } from '../catalogue.ts'
import { hmacBase64, timingSafeEqual } from '../crypto.ts'
import type {
  Cart,
  CartAdjustment,
  CartAdjustmentCode,
  CartLine,
  Money,
  Product,
  ProductVariant,
} from './types'

/**
 * Shopify Storefront API, read side.
 *
 * This is the *only* source of a customer-visible price. `catalogue.ts` holds
 * the copy — name, description, photography, alt text, the SKUs — and carries
 * no price at all any more (`PLACEHOLDER_PRICE_CENTS` is gone). The two are
 * joined here by SKU, which is why the size rename had to land before Shopify
 * inventory was loaded: the SKU is the join key.
 *
 * Raw `fetch` against GraphQL rather than `@shopify/storefront-api-client`:
 * that client would need a custom HTTP client to run on Workers, and this
 * file uses one query.
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
          id
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
            id?: string | null
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
  /** Shopify's own variant GID — the id cart mutations take. */
  merchandiseId: string
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

/**
 * The one place a GraphQL request actually goes out — inventory reads and
 * every cart mutation below share it, rather than each reimplementing the
 * status check and the "200 with an `errors` array" trap fetchInventory
 * used to guard alone. Returns the parsed body; callers still have to look
 * at their own `data.*` shape, since that differs per operation.
 */
async function storefrontRequest<T>(
  config: StorefrontConfig,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(endpoint(config.domain), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': config.token,
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new StorefrontError(
      `shopify storefront ${res.status}: ${await res.text()}`,
      `status=${res.status}`
    )
  }

  const body = (await res.json()) as { data?: T; errors?: { message?: string }[] }
  // GraphQL answers 200 with an `errors` array. Treating that as success is
  // how a partial response turns into a missing price rendered as a real one.
  if (body.errors?.length) {
    throw new StorefrontError(
      `shopify storefront: ${body.errors.map((e) => e.message).join('; ')}`,
      'graphql'
    )
  }
  return (body.data ?? {}) as T
}

async function fetchInventory(config: StorefrontConfig): Promise<Inventory> {
  const data = await storefrontRequest<InventoryResponse['data']>(config, INVENTORY_QUERY, {
    products: MAX_PRODUCTS,
    variants: MAX_VARIANTS,
  })

  const inventory: Inventory = new Map()
  for (const product of data?.products?.nodes ?? []) {
    for (const variant of product.variants?.nodes ?? []) {
      const sku = variant.sku?.trim()
      const merchandiseId = variant.id?.trim()
      if (!sku || !merchandiseId) continue
      const cents = parsePriceToCents(variant.price?.amount ?? '')
      // A price this file can't read, or one in a currency the site doesn't
      // sell in, is not a price — the variant is simply left unknown, which
      // reads downstream as "not sellable" rather than as a number.
      if (cents === null || variant.price?.currencyCode !== 'CAD') continue
      inventory.set(sku, {
        price: { amount: cents, currency: 'CAD' },
        available: variant.availableForSale === true,
        merchandiseId,
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

/**
 * Drops the cached price/availability read so the next request re-fetches
 * from Shopify instead of serving up to CACHE_TTL_MS of staleness.
 *
 * Two callers: the `orders/paid` webhook route, which invalidates the moment
 * an order confirms so a size that just sold out stops reading as available
 * on the very next request; and tests, where the module-level cache would
 * otherwise outlive a single test.
 */
export function resetStorefrontCache(): void {
  cache.clear()
  inFlight.clear()
}

/**
 * Verifies Shopify's webhook signature — base64 HMAC-SHA256 over the raw
 * request body, carried in `X-Shopify-Hmac-Sha256` — a different scheme from
 * Stripe's hex `t=`/`v1=` header, hence the separate `hmacBase64` helper in
 * crypto.ts rather than reusing `hmacHex`.
 */
export async function verifyShopifyWebhook(
  secret: string,
  payload: string,
  header: string | null
): Promise<boolean> {
  if (!header) return false
  const expected = await hmacBase64(secret, payload)
  return timingSafeEqual(expected, header)
}

/**
 * Every field a cart render needs, in one fragment shared by every cart
 * operation below — one place to widen if the band ever needs another field,
 * rather than five query strings drifting apart.
 *
 * `merchandise` is a union (`ProductVariant | ProductVariantComponent`, on
 * newer API versions) — this catalogue only ever adds a plain
 * `ProductVariant`, so the inline fragment is enough; a line whose
 * merchandise isn't one (shouldn't happen, but a union is a union) is simply
 * dropped in `parseCart` rather than crashing the whole cart render.
 */
const CART_FRAGMENT = `fragment NuageCart on Cart {
  id
  checkoutUrl
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount { amount currencyCode }
    totalTaxAmount { amount currencyCode }
  }
  lines(first: ${MAX_VARIANTS}) {
    nodes {
      id
      quantity
      cost { totalAmount { amount currencyCode } }
      merchandise {
        ... on ProductVariant {
          id
          sku
          title
          price { amount currencyCode }
        }
      }
    }
  }
}`

/**
 * Every cart mutation asks for this beside its `userErrors`.
 *
 * Shopify moved inventory problems *out* of `userErrors` in Storefront API
 * 2024-10 and into `warnings`: a `userError` means the mutation failed,
 * while a warning means it succeeded and Shopify silently changed the cart
 * to fit — clamping a line to the stock it actually had, or emptying it. So
 * a store with two left, asked for five, answers 200 with no error at all
 * and a line of two. Not selecting this field is how the site ends up
 * telling a visitor "added" and showing them a quantity they never chose.
 *
 * `target` is the affected line's id. Shopify intends it as input to
 * `cartLinesRemove`; here it just says which line to talk about.
 *
 * Worth knowing before trusting the clamp itself: Shopify's own behaviour
 * here is buggy on lines that aren't the cart's first
 * (Shopify/storefront-api-feedback#186 — quantity set to 0 instead of
 * clamped, acknowledged 2023, still open). The warning is reliable; the
 * resulting quantity is Shopify's to state, which is why `parseCart` reads
 * it back off the response rather than assuming the requested number.
 */
const CART_WARNINGS = `warnings { target code message }`

const CART_CREATE = `${CART_FRAGMENT}
mutation NuageCartCreate($merchandiseId: ID!, $quantity: Int!) {
  cartCreate(input: { lines: [{ merchandiseId: $merchandiseId, quantity: $quantity }] }) {
    cart { ...NuageCart }
    ${CART_WARNINGS}
    userErrors { field message }
  }
}`

const CART_LINES_ADD = `${CART_FRAGMENT}
mutation NuageCartLinesAdd($cartId: ID!, $merchandiseId: ID!, $quantity: Int!) {
  cartLinesAdd(cartId: $cartId, lines: [{ merchandiseId: $merchandiseId, quantity: $quantity }]) {
    cart { ...NuageCart }
    ${CART_WARNINGS}
    userErrors { field message }
  }
}`

const CART_LINES_UPDATE = `${CART_FRAGMENT}
mutation NuageCartLinesUpdate($cartId: ID!, $lineId: ID!, $quantity: Int!) {
  cartLinesUpdate(cartId: $cartId, lines: [{ id: $lineId, quantity: $quantity }]) {
    cart { ...NuageCart }
    ${CART_WARNINGS}
    userErrors { field message }
  }
}`

const CART_LINES_REMOVE = `${CART_FRAGMENT}
mutation NuageCartLinesRemove($cartId: ID!, $lineId: ID!) {
  cartLinesRemove(cartId: $cartId, lineIds: [$lineId]) {
    cart { ...NuageCart }
    ${CART_WARNINGS}
    userErrors { field message }
  }
}`

const CART_QUERY = `${CART_FRAGMENT}
query NuageCartQuery($cartId: ID!) {
  cart(id: $cartId) { ...NuageCart }
}`

interface RawCart {
  id: string
  checkoutUrl: string
  cost?: {
    subtotalAmount?: { amount?: string; currencyCode?: string }
    totalAmount?: { amount?: string; currencyCode?: string }
    // Absent (not merely zero) whenever Shopify has no tax registration to
    // quote from yet — the first drop ships with none configured. `money()`
    // needs a string to parse, so this stays undefined rather than a string,
    // and parseCart checks for that directly instead of forcing a `money()`
    // call that would render it as a confident $0.00.
    totalTaxAmount?: { amount?: string; currencyCode?: string } | null
  }
  lines?: {
    nodes?: {
      id: string
      quantity: number
      cost?: { totalAmount?: { amount?: string; currencyCode?: string } }
      merchandise?: {
        id?: string
        sku?: string | null
        title?: string
        price?: { amount?: string; currencyCode?: string }
      }
    }[]
  }
}

interface RawWarning {
  target?: string | null
  code?: string | null
  message?: string | null
}

interface CartMutationResponse {
  [key: string]:
    | {
        cart: RawCart | null
        warnings?: RawWarning[]
        userErrors?: { field?: string[]; message: string }[]
      }
    | undefined
}

interface CartQueryResponse {
  cart: RawCart | null
}

/**
 * "37.00" (or anything `parsePriceToCents` refuses) becomes 0 rather than a
 * dropped line: `fetchInventory` can afford to drop a variant it can't price
 * — the visitor never sees it — but a cart line the visitor already added is
 * not this file's to make disappear. Logged so a bad amount doesn't fail
 * silently the way a dropped inventory variant is allowed to.
 */
function money(amount: string | undefined, context: string): number {
  const cents = parsePriceToCents(amount ?? '')
  if (cents === null) {
    console.error(`storefront: could not parse a price ("${amount}") for ${context}`)
    return 0
  }
  return cents
}

/**
 * Shopify's warning codes, narrowed to the two this site can say something
 * about. Anything else — a discount code that didn't apply, a delivery
 * option that vanished — is dropped: see the note on `CartAdjustment`.
 * Logged rather than silently swallowed, because a new inventory-shaped code
 * appearing in a future API version should be a line in the Worker log, not
 * a quantity nobody was told about.
 */
const ADJUSTMENT_CODES: Record<string, CartAdjustmentCode> = {
  MERCHANDISE_NOT_ENOUGH_STOCK: 'not-enough-stock',
  MERCHANDISE_OUT_OF_STOCK: 'out-of-stock',
}

/** Only the codes above, and only the ones naming a line. */
function parseAdjustments(warnings: RawWarning[] | undefined): CartAdjustment[] {
  const adjustments: CartAdjustment[] = []
  for (const warning of warnings ?? []) {
    const code = warning.code ? ADJUSTMENT_CODES[warning.code] : undefined
    if (!code) {
      if (warning.code) console.error(`storefront: unhandled cart warning ${warning.code}`)
      continue
    }
    adjustments.push({ code, lineId: warning.target ?? '' })
  }
  return adjustments
}

function parseCart(raw: RawCart, warnings?: RawWarning[]): Cart {
  const lines: CartLine[] = []
  for (const line of raw.lines?.nodes ?? []) {
    const merchandiseId = line.merchandise?.id
    // Not a ProductVariant, or Shopify answered a line with no merchandise at
    // all (a deleted variant) — nothing to show for it, so it's dropped
    // rather than rendered as a blank row.
    if (!merchandiseId) continue
    lines.push({
      id: line.id,
      merchandiseId,
      // Blank rather than dropped when Shopify's own variant has no SKU set
      // (shouldn't happen for this catalogue, but nothing here enforces it)
      // — the catalogue join in CartView.astro treats an empty SKU the same
      // way it treats one that simply doesn't match: falls back to the
      // Shopify-only render for that line.
      sku: line.merchandise?.sku?.trim() ?? '',
      label: line.merchandise?.title ?? '',
      quantity: line.quantity,
      unitPrice: {
        amount: money(line.merchandise?.price?.amount, `line ${line.id} unit price`),
        currency: 'CAD',
      },
      linePrice: {
        amount: money(line.cost?.totalAmount?.amount, `line ${line.id} total`),
        currency: 'CAD',
      },
    })
  }
  return {
    id: raw.id,
    checkoutUrl: raw.checkoutUrl,
    adjustments: parseAdjustments(warnings),
    subtotal: { amount: money(raw.cost?.subtotalAmount?.amount, `cart ${raw.id} subtotal`), currency: 'CAD' },
    total: { amount: money(raw.cost?.totalAmount?.amount, `cart ${raw.id} total`), currency: 'CAD' },
    // Not run through money(): an absent totalTaxAmount means "no tax
    // registration yet", which is a fact to display ("calculated at
    // checkout"), not a price that failed to parse and should log as one.
    tax: raw.cost?.totalTaxAmount?.amount
      ? { amount: money(raw.cost.totalTaxAmount.amount, `cart ${raw.id} tax`), currency: 'CAD' }
      : null,
    lines,
  }
}

/**
 * Runs one cart mutation and resolves it to a `Cart`, or null.
 *
 * Null covers exactly one thing: Shopify no longer recognises the cart id
 * (past its own ~10-day TTL, or already turned into a completed order) —
 * that's not this file's error to raise, it reads as an empty cart and the
 * caller clears the cookie. `userErrors` on a cart Shopify *did* find (a
 * merchandise id it doesn't know, a malformed quantity) is a real refusal
 * and throws.
 *
 * Inventory is *not* one of those refusals, and hasn't been since 2024-10 —
 * it arrives as a `warning` on an otherwise successful mutation and rides
 * out on `Cart.adjustments`. See `CART_WARNINGS` above.
 */
async function runCartMutation(
  config: StorefrontConfig,
  query: string,
  operation: string,
  variables: Record<string, unknown>
): Promise<Cart | null> {
  const data = await storefrontRequest<CartMutationResponse>(config, query, variables)
  const result = data[operation]
  if (!result || !result.cart) return null
  if (result.userErrors?.length) {
    throw new StorefrontError(
      `shopify storefront: ${result.userErrors.map((e) => e.message).join('; ')}`,
      'cart-user-error'
    )
  }
  return parseCart(result.cart, result.warnings)
}

export interface StorefrontSource {
  readonly name: string
  /**
   * The catalogue product for `slug`, priced from Shopify, or null when
   * Shopify can't answer for it. Never throws for an unreachable store: the
   * caller renders the no-price state instead (see `getLiveProduct` in
   * ./index.ts).
   */
  getProduct(slug: string, locale: Locale): Promise<Product | null>
  /** A fresh cart holding one line. */
  createCart(merchandiseId: string, quantity: number): Promise<Cart>
  /** Adds a line to an existing cart, or null if Shopify no longer knows that cart. */
  addLine(cartId: string, merchandiseId: string, quantity: number): Promise<Cart | null>
  /** Sets a line's quantity outright (0 removes it) — same null rule as `addLine`. */
  updateLine(cartId: string, lineId: string, quantity: number): Promise<Cart | null>
  /** Same null rule as `addLine`. */
  removeLine(cartId: string, lineId: string): Promise<Cart | null>
  /** The cart as it stands right now — never cached, unlike `getProduct`. */
  getCart(cartId: string): Promise<Cart | null>
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
        // Absent for the same reason `inStock` is false: nothing to add to a
        // cart for a SKU Shopify never answered with.
        merchandiseId: inventory.get(variant.sku)?.merchandiseId,
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

    async createCart(merchandiseId, quantity): Promise<Cart> {
      const data = await storefrontRequest<CartMutationResponse>(config, CART_CREATE, {
        merchandiseId,
        quantity,
      })
      const result = data.cartCreate
      if (result?.userErrors?.length) {
        throw new StorefrontError(
          `shopify storefront: ${result.userErrors.map((e) => e.message).join('; ')}`,
          'cart-user-error'
        )
      }
      if (!result?.cart) {
        throw new StorefrontError('shopify storefront: cartCreate returned no cart', 'cart-user-error')
      }
      return parseCart(result.cart, result.warnings)
    },

    addLine(cartId, merchandiseId, quantity) {
      return runCartMutation(config, CART_LINES_ADD, 'cartLinesAdd', { cartId, merchandiseId, quantity })
    },

    updateLine(cartId, lineId, quantity) {
      return runCartMutation(config, CART_LINES_UPDATE, 'cartLinesUpdate', { cartId, lineId, quantity })
    },

    removeLine(cartId, lineId) {
      return runCartMutation(config, CART_LINES_REMOVE, 'cartLinesRemove', { cartId, lineId })
    },

    async getCart(cartId): Promise<Cart | null> {
      const data = await storefrontRequest<CartQueryResponse>(config, CART_QUERY, { cartId })
      return data.cart ? parseCart(data.cart) : null
    },
  }
}
