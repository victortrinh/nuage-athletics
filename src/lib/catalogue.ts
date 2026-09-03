import type { Locale } from '../i18n/config'
import type { Product, ProductVariant } from './commerce/types'

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
 * Placeholder. This must be set to the real number before COMMERCE_ENABLED is
 * ever flipped to "true" — an advertised price is one a Quebec merchant is
 * expected to honour. Nothing renders it while commerce is off; see
 * `commerceEnabled` in ./commerce/index.ts.
 */
const PLACEHOLDER_PRICE_CENTS = 6500

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'] as const

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
 * Fit × size = 12 variants, fit-major. `label` composes the fit and size name
 * (e.g. "Crop · M") and is what ends up on the Stripe line item and receipt —
 * see `stripe.ts`, which reads `variant.label` directly and needed no changes
 * for this. `options` carries the same two facts as ids, for `ProductActions`
 * to resolve a variant from a (fit, size) selection without re-deriving the
 * id scheme in a second file.
 */
function variants(productId: string, skuBase: string, locale: Locale): ProductVariant[] {
  return FIT_IDS.flatMap((fit) =>
    SIZES.map((size) => ({
      id: `${productId}-${fit}-${size.toLowerCase()}`,
      sku: `${skuBase}-${FIT_SKU[fit]}-${size}`,
      label: `${FIT_NAMES[locale][fit]} · ${size}`,
      inStock: true,
      options: { fit, size },
    }))
  )
}

/** View order within a fit's gallery, per the product page's spec: front, back, worn front, worn back. */
type ViewId = 'front' | 'back' | 'front-worn' | 'back-worn'
const VIEWS = ['front', 'back', 'front-worn', 'back-worn'] as const satisfies readonly ViewId[]

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
    'front-worn': { src: '/img/ls-01-classic-front-worn.webp', width: 801, height: 1560 },
    'back-worn': { src: '/img/ls-01-classic-back-worn.webp', width: 826, height: 1560 },
  },
  crop: {
    front: { src: '/img/ls-01-crop-front.webp', width: 1280, height: 601 },
    back: { src: '/img/ls-01-crop-back.webp', width: 1280, height: 492 },
    'front-worn': { src: '/img/ls-01-crop-front-worn.webp', width: 844, height: 1560 },
    'back-worn': { src: '/img/ls-01-crop-back-worn.webp', width: 849, height: 1560 },
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
      'front-worn': 'Manches longues 01, coupe classique, porté, vue de face',
      'back-worn': 'Manches longues 01, coupe classique, porté, vue de dos',
    },
    crop: {
      front: 'Manches longues 01, coupe crop, vue de face, à plat',
      back: 'Manches longues 01, coupe crop, vue de dos, à plat',
      'front-worn': 'Manches longues 01, coupe crop, porté, vue de face',
      'back-worn': 'Manches longues 01, coupe crop, porté, vue de dos',
    },
  },
  'en-CA': {
    classic: {
      front: 'Long Sleeve 01, classic fit, front, laid flat',
      back: 'Long Sleeve 01, classic fit, back, laid flat',
      'front-worn': 'Long Sleeve 01, classic fit, worn, front view',
      'back-worn': 'Long Sleeve 01, classic fit, worn, back view',
    },
    crop: {
      front: 'Long Sleeve 01, cropped fit, front, laid flat',
      back: 'Long Sleeve 01, cropped fit, back, laid flat',
      'front-worn': 'Long Sleeve 01, cropped fit, worn, front view',
      'back-worn': 'Long Sleeve 01, cropped fit, worn, back view',
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

export const CATALOGUE: Record<Locale, Product[]> = {
  'fr-CA': [
    {
      id: 'ls-01',
      slug: SLUGS['ls-01']['fr-CA'],
      slugs: SLUGS['ls-01'],
      name: 'Manches longues 01',
      description:
        'Un chandail à manches longues en laine mérinos et modal. Plus de détails à venir.',
      price: { amount: PLACEHOLDER_PRICE_CENTS, currency: 'CAD' },
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
        'A long sleeve in merino wool and modal. More details to come.',
      price: { amount: PLACEHOLDER_PRICE_CENTS, currency: 'CAD' },
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
        { label: 'Tailles', value: 'XS – 2XL' },
        { label: 'Entretien', value: 'Lavage à froid, séchage à plat' },
        { label: 'Origine', value: 'Fabriqué au Canada' },
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
        { label: 'Sizes', value: 'XS – 2XL' },
        { label: 'Care', value: 'Cold wash, dry flat' },
        { label: 'Origin', value: 'Made in Canada' },
      ],
    },
  },
}

/** The single SKU the site is built around today. */
export const FEATURED_ID = 'ls-01'

export function getCatalogueProduct(slug: string, locale: Locale): Product | null {
  return CATALOGUE[locale].find((p) => p.slug === slug) ?? null
}

export function featuredProduct(locale: Locale): Product {
  const product = CATALOGUE[locale].find((p) => p.id === FEATURED_ID)
  if (!product) throw new Error(`featured product ${FEATURED_ID} missing from ${locale} catalogue`)
  return product
}

export function editorialFor(id: string, locale: Locale): ProductEditorial {
  const editorial = EDITORIAL[locale][id]
  if (!editorial) throw new Error(`no editorial content for ${id} in ${locale}`)
  return editorial
}
