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
} as const

export type RouteId = keyof typeof ROUTES

export function route(id: RouteId, locale: Locale): string {
  return ROUTES[id][locale]
}

/** All locale variants of a route, for hreflang. */
export function alternates(id: RouteId): { locale: Locale; path: string }[] {
  return LOCALES.map((l) => ({ locale: l, path: ROUTES[id][l] }))
}
