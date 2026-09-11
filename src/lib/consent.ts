import { UI } from '../i18n/ui.ts'
import type { Locale } from '../i18n/config.ts'

/**
 * Bump this whenever the consent wording changes. Existing rows keep the version
 * they were captured under — that is the entire point. Never backfill it.
 */
export const CONSENT_VERSION = '2026-08-05.1'

export function consentText(locale: Locale): string {
  return UI[locale].consentLabel
}

/** Mailing address required in every commercial email under CASL. */
export const SENDER_IDENTITY = {
  name: 'Nuage Athletics',
  email: 'hello@nuageathletics.com',
  // TODO: replace with the real registered mailing address before the first send.
  address: '[ADRESSE POSTALE REQUISE / MAILING ADDRESS REQUIRED]',
} as const

/**
 * Shopify's checkout marketing opt-in wording, transcribed from the store's
 * checkout settings. Shopify reports consent *state* and never the text, so
 * this constant is the only record of what a checkout opt-in agreed to.
 *
 * Its own version, not CONSENT_VERSION: the site's own wording is unchanged,
 * and one version label has to map to exactly one wording or the evidence is
 * worthless.
 *
 * Two caveats a later reader needs:
 *  - In the admin this field renders grey, i.e. it is Shopify's default rather
 *    than a saved override. Type it in and save it there so a change to
 *    Shopify's defaults can't silently desynchronise this constant.
 *  - Shopify never reports which language a customer saw at checkout. We pick
 *    the wording by the customer's locale. Good proxy, not a guarantee.
 */
export const SHOPIFY_CONSENT_VERSION = 'shopify-checkout.2026-09-11.1'

export const SHOPIFY_CHECKOUT_CONSENT: Record<Locale, string> = {
  'fr-CA': 'Envoyez-moi des nouvelles et des offres par e-mail',
  'en-CA': 'Email me with news and offers',
}
