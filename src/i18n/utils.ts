import { LOCALE_PREFIX, LOCALES, type Locale } from './config'

/** Build a locale-aware path. `path` is the FR-canonical route, e.g. '/confidentialite' */
export function localePath(locale: Locale, path: string): string {
  const clean = path === '/' ? '' : path
  return `${LOCALE_PREFIX[locale]}${clean}` || '/'
}

/**
 * Route table. Keys are logical page ids; values are the URL segment per locale.
 * Localised URLs are worth the small overhead: they read better and they are a
 * clearer signal that the French site is a first-class version, not a translation layer.
 */
export const ROUTES = {
  home: { 'fr-CA': '/', 'en-CA': '/en/' },
  privacy: { 'fr-CA': '/confidentialite/', 'en-CA': '/en/privacy/' },
  terms: { 'fr-CA': '/conditions/', 'en-CA': '/en/terms/' },
  confirmed: { 'fr-CA': '/inscription-confirmee/', 'en-CA': '/en/confirmed/' },
  unsubscribed: { 'fr-CA': '/desabonnement/', 'en-CA': '/en/unsubscribed/' },
  orderConfirmed: { 'fr-CA': '/commande-confirmee/', 'en-CA': '/en/order-confirmed/' },
  orderCancelled: { 'fr-CA': '/commande-annulee/', 'en-CA': '/en/order-cancelled/' },
} as const

export type RouteId = keyof typeof ROUTES

export function route(id: RouteId, locale: Locale): string {
  return ROUTES[id][locale]
}

/** All locale variants of a route, for hreflang. */
export function alternates(id: RouteId): { locale: Locale; path: string }[] {
  return LOCALES.map((l) => ({ locale: l, path: ROUTES[id][l] }))
}

/**
 * Product pages aren't in ROUTES: the slug differs per locale (it's part of
 * the catalogue, not a fixed page id), so canonical/hreflang for these is
 * built from the product's own per-locale slugs — see productAlternates.
 */
const PRODUCT_BASE: Record<Locale, string> = {
  'fr-CA': '/produit',
  'en-CA': '/en/product',
}

export function productPath(locale: Locale, slug: string): string {
  return `${PRODUCT_BASE[locale]}/${slug}/`
}

export function productAlternates(
  slugs: Record<Locale, string>
): { locale: Locale; path: string }[] {
  return LOCALES.map((l) => ({ locale: l, path: productPath(l, slugs[l]) }))
}
