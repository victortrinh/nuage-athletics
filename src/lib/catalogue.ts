import type { Locale } from '../i18n/config'
import type { Product } from './commerce/types'

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

/** Size labels are the same in both locales, so they are generated, not translated. */
function variants(productId: string, skuBase: string) {
  return SIZES.map((label) => ({
    id: `${productId}-${label.toLowerCase()}`,
    sku: `${skuBase}-${label}`,
    label,
    inStock: true,
  }))
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
      images: [],
      variants: variants('ls-01', 'NA-LS01'),
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
      images: [],
      variants: variants('ls-01', 'NA-LS01'),
    },
  ],
}

/**
 * A slot in the product gallery. There are no photographs yet, so every slot
 * ships with no `src` and renders as a placeholder block at the right aspect
 * ratio — the layout is already final, only the pixels are missing. Filling in
 * `src` is the entire swap when the shoot lands.
 */
export interface GallerySlot {
  src?: string
  alt: string
  ratio: '4/5' | '1/1'
}

/**
 * Editorial content — the spec sheet and the gallery.
 *
 * Kept out of `Product` on purpose: that interface is the commerce contract a
 * Lightspeed adapter would also have to satisfy, and none of this belongs in
 * it. Spec labels live here rather than in `ui.ts` because they are product
 * facts that change with the garment, not interface chrome; the
 * `Record<Locale, …>` shape still makes an untranslated one a type error.
 */
export interface ProductEditorial {
  gallery: GallerySlot[]
  specs: { label: string; value: string }[]
}

const GALLERY_SHAPE: GallerySlot['ratio'][] = ['4/5', '4/5', '1/1', '4/5', '1/1', '4/5']

export const EDITORIAL: Record<Locale, Record<string, ProductEditorial>> = {
  'fr-CA': {
    'ls-01': {
      gallery: GALLERY_SHAPE.map((ratio, i) => ({
        ratio,
        alt: `Manches longues 01 — vue ${i + 1}`,
      })),
      specs: [
        { label: 'Composition', value: '50 % laine mérinos, 50 % modal' },
        { label: 'Coupe', value: 'Régulière' },
        { label: 'Tailles', value: 'XS – 2XL' },
        { label: 'Entretien', value: 'Lavage à froid, séchage à plat' },
        { label: 'Origine', value: 'Fabriqué au Canada' },
      ],
    },
  },
  'en-CA': {
    'ls-01': {
      gallery: GALLERY_SHAPE.map((ratio, i) => ({
        ratio,
        alt: `Long Sleeve 01 — view ${i + 1}`,
      })),
      specs: [
        { label: 'Composition', value: '50% merino wool, 50% modal' },
        { label: 'Fit', value: 'Regular' },
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
