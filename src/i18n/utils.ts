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
  precontract: {
    'fr-CA': '/informations-precontractuelles/',
    'en-CA': '/en/pre-contract-information/',
  },
  confirmed: { 'fr-CA': '/inscription-confirmee/', 'en-CA': '/en/confirmed/' },
  unsubscribed: { 'fr-CA': '/desabonnement/', 'en-CA': '/en/unsubscribed/' },
  orderConfirmed: { 'fr-CA': '/commande-confirmee/', 'en-CA': '/en/order-confirmed/' },
  orderCancelled: { 'fr-CA': '/commande-annulee/', 'en-CA': '/en/order-cancelled/' },
  cart: { 'fr-CA': '/panier/', 'en-CA': '/en/cart/' },
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
 * Which routes may be indexed.
 *
 * One table, because two things have to agree and previously didn't: the
 * `noindex` meta `Seo.astro` renders, and the URLs `@astrojs/sitemap`
 * publishes. Each page used to pass `noindex` itself while the sitemap
 * published every route it could find, so the sitemap advertised fourteen
 * noindex pages. Now `Seo.astro` reads this and so does the sitemap's `filter`
 * (astro.config.mjs), and flipping a page's indexability is one edit here.
 *
 * `Record<RouteId, boolean>` is exhaustive by construction, so a route added
 * to ROUTES is a type error until someone decides — the same reasoning
 * `Dict` in src/i18n/ui.ts follows.
 */
export const INDEXABLE: Record<RouteId, boolean> = {
  home: true,
  // Drafts pending legal review — see the notice at the top of each. Flip
  // these when the reviewed text ships and the sitemap follows on its own.
  privacy: false,
  terms: false,
  precontract: false,
  // Dead ends reached from an email link or a checkout return. Nothing on
  // them is worth ranking, and confirmed/unsubscribed leak an intent we have
  // no business publishing.
  confirmed: false,
  unsubscribed: false,
  orderConfirmed: false,
  orderCancelled: false,
  // A visitor's own working cart — nothing on it is worth ranking, and the
  // same reasoning INDEXABLE gives confirmed/unsubscribed applies here too.
  cart: false,
}

/**
 * Which routes show the bottom-anchored signup prompt (SignupPrompt.astro) —
 * the site's only signup surface. The pre-launch gate screen and the "notify
 * me" block in ProductActions.tsx used to carry their own inline SignupForm;
 * both were removed once this could cover them, rather than showing two
 * consent forms on one page.
 *
 * `Record<RouteId, boolean>` for the same reason INDEXABLE is one: a route
 * added to ROUTES is a type error here until someone decides.
 *
 * Off for the three dead ends reached only from an email link or a checkout
 * return: offering a signup to someone who just subscribed, or just
 * unsubscribed, is a CASL-flavoured problem, not only a UX one.
 */
export const SHOWS_SIGNUP_PROMPT: Record<RouteId, boolean> = {
  home: true,
  privacy: true,
  terms: true,
  precontract: true,
  confirmed: false,
  unsubscribed: false,
  orderConfirmed: false,
  orderCancelled: true,
  // The visitor is already mid-purchase-decision on this page; a signup
  // prompt competing with the checkout button for attention is the wrong
  // moment for it.
  cart: false,
}

/** Every indexable route's path, in every locale — the sitemap's allowlist. */
export const INDEXABLE_PATHS: readonly string[] = (Object.keys(ROUTES) as RouteId[])
  .filter((id) => INDEXABLE[id])
  .flatMap((id) => LOCALES.map((l) => ROUTES[id][l]))

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
