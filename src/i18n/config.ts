export const LOCALES = ['fr-CA', 'en-CA'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'fr-CA'

/** Astro serves the default locale from the root, other locales from /<prefix>/ */
export const LOCALE_PREFIX: Record<Locale, string> = {
  'fr-CA': '',
  'en-CA': '/en',
}

export const LOCALE_LABEL: Record<Locale, string> = {
  'fr-CA': 'FR',
  'en-CA': 'EN',
}

/** <html lang> value */
export const HTML_LANG: Record<Locale, string> = {
  'fr-CA': 'fr-CA',
  'en-CA': 'en-CA',
}

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v)
}

/** Derive locale from a pathname. Anything not under /en is French. */
export function localeFromPath(pathname: string): Locale {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en-CA' : 'fr-CA'
}
