import type { Locale } from '../../i18n/config'

/**
 * Shared commerce types. Shopify is the only provider — `./shopify.ts`
 * implements `StorefrontSource` via the Storefront API, and `./index.ts`'s
 * `getLiveProduct`/`readCart`/`mutateCart` are the seam every page and route
 * goes through. Nothing under src/pages should import a provider directly
 * (CLAUDE.md non-negotiable 5): a future provider swap means a new
 * `StorefrontSource` implementation and a one-line change in ./index.ts.
 */

export interface Money {
  /** minor units, e.g. cents */
  amount: number
  currency: 'CAD'
}

export interface ProductVariant {
  id: string
  sku: string
  label: string // e.g. "Classique · M"
  inStock: boolean
  /**
   * The option axes this variant sits on, as ids never display strings
   * (e.g. { fit: 'crop', size: 'M' }). Generic on purpose: this interface is
   * the contract a Lightspeed adapter must also satisfy, and "fit" is a fact
   * about this garment, not something the commerce contract should hardcode.
   * Optional so a single-axis product needs none.
   */
  options?: Record<string, string>
  /**
   * The provider's own id for this exact variant — a Shopify variant GID,
   * opaque to everything outside `./shopify.ts`. `catalogue.ts`'s own `id`
   * (`ls-01-classic-m`) is this site's stable identifier for the variant and
   * is never enough on its own to add a line to a cart: Shopify's cart
   * mutations take its GID, not ours. Optional and absent whenever the
   * catalogue has no live join for this SKU — see `getLiveProduct`.
   */
  merchandiseId?: string
}

export interface Product {
  id: string
  slug: string
  /** This product's slug in every locale, for hreflang alternates. */
  slugs: Record<Locale, string>
  name: string
  description: string
  price: Money
  images: string[]
  variants: ProductVariant[]
}

/** One line in a cart — a variant, the quantity of it, and what that quantity costs. */
export interface CartLine {
  id: string
  merchandiseId: string
  /**
   * The catalogue's own join key — `''` when Shopify's variant carries none.
   * `CartView.astro` uses it to look the line back up in `catalogue.ts` for a
   * thumbnail, fit and size; a line that doesn't join still renders from
   * `label`/`unitPrice`/`linePrice` alone. See non-negotiable 5.5: this is a
   * lookup key, not a price, so there is no failure mode here for that rule
   * to guard against.
   */
  sku: string
  label: string
  quantity: number
  unitPrice: Money
  linePrice: Money
}

export interface Cart {
  id: string
  lines: CartLine[]
  subtotal: Money
  /**
   * Shopify's own grand total (`cost.totalAmount`) — rendered as-is, never
   * computed from `subtotal` here, so a store that later adds shipping or
   * tax can't silently disagree with what this page shows. Today, with
   * neither configured, it equals `subtotal`.
   */
  total: Money
  /**
   * `null` when Shopify has no tax registration to quote from yet (true for
   * the first drop) — distinct from a real $0 so a fabricated number never
   * gets rendered as a considered answer. Unlike shipping, this isn't
   * "unknown until checkout": with no registration the tax owed genuinely is
   * zero (see #64), so `CartView.astro` simply omits the row rather than
   * claiming a tax is still to be calculated. See non-negotiable 5.5's
   * reasoning: an advertised total is one a Quebec merchant is expected to
   * honour, and a silently-omitted tax is not an honest total.
   */
  tax: Money | null
  /** Shopify's hosted checkout for this cart — where "Buy" hands off to. */
  checkoutUrl: string
}
