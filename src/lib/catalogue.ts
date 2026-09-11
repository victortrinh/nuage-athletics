import type { Locale } from '../i18n/config'
import type { Money, Product, ProductVariant } from './commerce/types'

/**
 * The catalogue, deliberately free of any commerce backend.
 *
 * This used to live inside the Stripe adapter, which made it unreachable
 * whenever Stripe wasn't configured — `getCommerce()` throws without a secret
 * key. The homepage now renders the product while commerce is still switched
 * off, so product data has to exist independently of who eventually sells it.
 *
 * Nothing here imports Stripe. `src/lib/commerce/stripe.ts` reads *from* this
 * file, which keeps CLAUDE.md's rule intact: pages can import the catalogue
 * without gaining a path to a payment provider.
 */

export const SLUGS: Record<string, Record<Locale, string>> = {
  'ls-01': { 'fr-CA': 'chandail-manches-longues-01', 'en-CA': 'long-sleeve-01' },
}

/**
 * Copy, minus the price.
 *
 * There is no price in this file at all — `PLACEHOLDER_PRICE_CENTS` used to
 * sit here with a note to replace it before the drop, and a placeholder one
 * edit away from being served as a real number is exactly the failure
 * non-negotiable 5.5 is about. The price now comes from Shopify and nowhere
 * else (`./commerce/shopify.ts`), joined to this copy by SKU, so the number
 * on the product page and the number at checkout cannot disagree.
 *
 * Availability is missing for the same reason. Every variant here used to
 * report `inStock: true` unconditionally, which is a claim this file has no
 * way to make good on; Shopify's `availableForSale` is the only answer, and
 * leaving the field off the type means nothing can render the old lie.
 *
 * `merchandiseId` is missing for the same reason again: it's Shopify's GID
 * for the variant, and this file has no way to know it either — only the
 * live join in `./commerce/shopify.ts` does.
 */
export type CatalogueVariant = Omit<ProductVariant, 'inStock' | 'merchandiseId'>
export type CatalogueProduct = Omit<Product, 'price' | 'variants'> & {
  variants: CatalogueVariant[]
}

const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'] as const

/** The two garment fits. Ids only — display names live in FIT_NAMES below. */
export type FitId = 'classic' | 'crop'
export const FIT_IDS = ['classic', 'crop'] as const satisfies readonly FitId[]
export const DEFAULT_FIT: FitId = 'classic'

const FIT_SKU: Record<FitId, string> = { classic: 'CLA', crop: 'CRP' }

/**
 * Fit display names. Kept here rather than in `ui.ts`'s `Dict`: a fit name is
 * a product fact that changes with the garment, not interface chrome — the
 * same reasoning `ProductEditorial`'s spec labels already follow below.
 * `Record<Locale, …>` still makes a missing translation a type error.
 */
const FIT_NAMES: Record<Locale, Record<FitId, string>> = {
  'fr-CA': { classic: 'Classique', crop: 'Crop' },
  'en-CA': { classic: 'Classic', crop: 'Cropped' },
}

/**
 * Fit × size = 14 variants, fit-major. `label` composes the fit and size name
 * (e.g. "Crop · M") and is what ends up on the Stripe line item and receipt —
 * see `stripe.ts`, which reads `variant.label` directly and needed no changes
 * for this. `options` carries the same two facts as ids, for `ProductStage`
 * to resolve a variant from a (fit, size) selection without re-deriving the
 * id scheme in a second file.
 */
function variants(productId: string, skuBase: string, locale: Locale): CatalogueVariant[] {
  return FIT_IDS.flatMap((fit) =>
    SIZES.map((size) => ({
      id: `${productId}-${fit}-${size.toLowerCase()}`,
      sku: `${skuBase}-${FIT_SKU[fit]}-${size}`,
      label: `${FIT_NAMES[locale][fit]} · ${size}`,
      options: { fit, size },
    }))
  )
}

/**
 * View order within a fit's gallery: front, back. Used to carry the worn
 * shots too (front-worn/back-worn) — dropped from the gallery as a
 * deliberate edit, not an oversight, so a future photography update
 * doesn't quietly resurrect them by re-adding the ids here without
 * re-reading this note. The source files are still under public/img if
 * they're wanted again.
 */
type ViewId = 'front' | 'back'
const VIEWS = ['front', 'back'] as const satisfies readonly ViewId[]

interface ImageAsset {
  src: string
  width: number
  height: number
}

/** Encoded from the source photography at build time; see the image pipeline notes in CLAUDE.md. */
const IMAGES: Record<FitId, Record<ViewId, ImageAsset>> = {
  classic: {
    front: { src: '/img/ls-01-classic-front.webp', width: 1280, height: 615 },
    back: { src: '/img/ls-01-classic-back.webp', width: 1280, height: 620 },
  },
  crop: {
    front: { src: '/img/ls-01-crop-front.webp', width: 1280, height: 601 },
    back: { src: '/img/ls-01-crop-back.webp', width: 1280, height: 492 },
  },
}

/**
 * Alt text per locale × fit × view. Not composed from parts — French word
 * order differs from English, and a copywriter needs to be able to edit
 * these directly. The `Record` nesting keeps a missing one a type error.
 */
const ALT: Record<Locale, Record<FitId, Record<ViewId, string>>> = {
  'fr-CA': {
    classic: {
      front: 'Manches longues 01, coupe classique, vue de face, à plat',
      back: 'Manches longues 01, coupe classique, vue de dos, à plat',
    },
    crop: {
      front: 'Manches longues 01, coupe crop, vue de face, à plat',
      back: 'Manches longues 01, coupe crop, vue de dos, à plat',
    },
  },
  'en-CA': {
    classic: {
      front: 'Long Sleeve 01, classic fit, front, laid flat',
      back: 'Long Sleeve 01, classic fit, back, laid flat',
    },
    crop: {
      front: 'Long Sleeve 01, cropped fit, front, laid flat',
      back: 'Long Sleeve 01, cropped fit, back, laid flat',
    },
  },
}

function galleryFor(locale: Locale, fit: FitId): GalleryImage[] {
  return VIEWS.map((view) => ({ ...IMAGES[fit][view], alt: ALT[locale][fit][view] }))
}

function fitsFor(locale: Locale): ProductFit[] {
  return FIT_IDS.map((id) => ({ id, label: FIT_NAMES[locale][id], gallery: galleryFor(locale, id) }))
}

function allImagePaths(): string[] {
  return FIT_IDS.flatMap((fit) => VIEWS.map((view) => IMAGES[fit][view].src))
}

export const CATALOGUE: Record<Locale, CatalogueProduct[]> = {
  'fr-CA': [
    {
      id: 'ls-01',
      slug: SLUGS['ls-01']['fr-CA'],
      slugs: SLUGS['ls-01'],
      name: 'Manches longues 01',
      description:
        'Un chandail à manches longues en laine mérinos et modal, conçu au Québec et fabriqué en Chine.',
      images: allImagePaths(),
      variants: variants('ls-01', 'NA-LS01', 'fr-CA'),
    },
  ],
  'en-CA': [
    {
      id: 'ls-01',
      slug: SLUGS['ls-01']['en-CA'],
      slugs: SLUGS['ls-01'],
      name: 'Long Sleeve 01',
      description:
        'A long sleeve in merino wool and modal, designed in Quebec and made in China.',
      images: allImagePaths(),
      variants: variants('ls-01', 'NA-LS01', 'en-CA'),
    },
  ],
}

/** One image in a fit's gallery, in display order. */
export interface GalleryImage extends ImageAsset {
  alt: string
}

/** One fit's worth of product photography. */
export interface ProductFit {
  id: FitId
  label: string
  gallery: GalleryImage[]
}

/**
 * Editorial content — the spec sheet and the per-fit galleries.
 *
 * Kept out of `Product` on purpose: that interface is the commerce contract a
 * Lightspeed adapter would also have to satisfy, and none of this belongs in
 * it. Spec labels live here rather than in `ui.ts` because they are product
 * facts that change with the garment, not interface chrome; the
 * `Record<Locale, …>` shape still makes an untranslated one a type error.
 */
export interface ProductEditorial {
  fits: ProductFit[]
  specs: { label: string; value: string }[]
}

export const EDITORIAL: Record<Locale, Record<string, ProductEditorial>> = {
  'fr-CA': {
    'ls-01': {
      fits: fitsFor('fr-CA'),
      // JSON-LD `material` in ProductView.astro reads specs[0] — keep Composition first.
      specs: [
        { label: 'Composition', value: '50 % laine mérinos, 50 % modal' },
        { label: 'Coupes', value: 'Classique ou crop' },
        { label: 'Tailles', value: 'XXS – XXL' },
        { label: 'Entretien', value: 'Lavage à froid, séchage à plat' },
        // Two facts, two rows, on purpose: this brand is designed in Quebec
        // and manufactured in China, and folding that into one "Origine" row
        // (as an earlier version of this file did, saying "Fabriqué au
        // Canada") is exactly the false country-of-manufacture claim the
        // note on `tagline` in src/i18n/ui.ts warns about. Keep them apart.
        { label: 'Conception', value: 'Québec, Canada' },
        { label: 'Fabrication', value: 'Chine' },
      ],
    },
  },
  'en-CA': {
    'ls-01': {
      fits: fitsFor('en-CA'),
      // JSON-LD `material` in ProductView.astro reads specs[0] — keep Composition first.
      specs: [
        { label: 'Composition', value: '50% merino wool, 50% modal' },
        { label: 'Fits', value: 'Classic or cropped' },
        { label: 'Sizes', value: 'XXS – XXL' },
        { label: 'Care', value: 'Cold wash, dry flat' },
        { label: 'Design', value: 'Quebec, Canada' },
        { label: 'Made in', value: 'China' },
      ],
    },
  },
}

/** The single SKU the site is built around today. */
export const FEATURED_ID = 'ls-01'

export function getCatalogueProduct(slug: string, locale: Locale): CatalogueProduct | null {
  return CATALOGUE[locale].find((p) => p.slug === slug) ?? null
}

/**
 * The reverse of the SKU join `./commerce/shopify.ts` uses to price a
 * variant: given a SKU a cart line came back with, find the catalogue
 * product and variant it names. Used by `CartView.astro` to render a line's
 * thumbnail, fit and size from data this file already owns, rather than
 * carrying photography through the Storefront round trip. Null for a SKU
 * that doesn't match anything here — not an error, since a cart line renders
 * fine from its own Shopify-supplied label and price with no catalogue
 * match at all (see the note on `CartLine.sku`).
 */
export function catalogueVariantBySku(
  sku: string,
  locale: Locale
): { product: CatalogueProduct; variant: CatalogueVariant } | null {
  for (const product of CATALOGUE[locale]) {
    const variant = product.variants.find((v) => v.sku === sku)
    if (variant) return { product, variant }
  }
  return null
}

export function featuredProduct(locale: Locale): CatalogueProduct {
  const product = CATALOGUE[locale].find((p) => p.id === FEATURED_ID)
  if (!product) throw new Error(`featured product ${FEATURED_ID} missing from ${locale} catalogue`)
  return product
}

export function editorialFor(id: string, locale: Locale): ProductEditorial {
  const editorial = EDITORIAL[locale][id]
  if (!editorial) throw new Error(`no editorial content for ${id} in ${locale}`)
  return editorial
}

/**
 * Same formatting `sendOrderConfirmationEmail` (src/lib/email.ts) already
 * does for a receipt — locale-aware via `Intl.NumberFormat`'s own currency
 * symbol/spacing rules (e.g. "65,00 $" vs "$65.00"), rather than a hand-built
 * string. Called server-side only (ProductView.astro), and only ever on a
 * `Money` that came back from Shopify — this file has no number of its own
 * to format. See non-negotiable 5.5 in CLAUDE.md.
 */
export function formatPrice(price: Money, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency }).format(
    price.amount / 100
  )
}
