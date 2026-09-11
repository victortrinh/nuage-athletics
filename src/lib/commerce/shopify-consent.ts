import type { Locale } from '../../i18n/config'
import { isLocale } from '../../i18n/config'
import { SHOPIFY_CHECKOUT_CONSENT, SHOPIFY_CONSENT_VERSION } from '../consent'

/**
 * Shape of the fields this codebase reads off a Shopify `customers/create` /
 * `customers/update` webhook payload. Shopify's payload carries much more —
 * this is deliberately narrow to what `consentFromPayload` needs.
 */
export interface CustomerWebhookPayload {
  email?: string | null
  locale?: string | null
  email_marketing_consent?: {
    state?: string | null
    opt_in_level?: string | null
    consent_updated_at?: string | null
  } | null
}

export interface ShopifyConsentRow {
  email: string
  locale: Locale
  consentText: string
  consentVersion: string
  consentedAt: number
}

/**
 * `fr*` (fr, fr-CA, fr-FR, …) maps to fr-CA, everything else — including a
 * missing or unrecognised value — falls back to en-CA. Shopify's `locale` is
 * a loose customer-preference field, not one of this site's two locale
 * strings, so this can't just delegate to `isLocale`.
 */
export function localeFromShopify(value: string | null | undefined): Locale {
  if (isLocale(value ?? '')) return value as Locale
  return (value ?? '').trim().toLowerCase().startsWith('fr') ? 'fr-CA' : 'en-CA'
}

/** Matches the zod `.trim().toLowerCase()` normalisation in subscribe.ts so a
 * Shopify email and a site-signup email for the same address compare equal. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * The entire consent gate for a Shopify customer event. Everything
 * downstream — the webhook route, the D1 insert — trusts this function's
 * verdict, which is why it is pure and directly unit-tested rather than only
 * exercised indirectly through the route.
 *
 * Returns null (never import) unless the payload both names an email and
 * reports an active 'subscribed' marketing state — every other state
 * (pending, not_subscribed, unsubscribed, invalid, redacted, or missing
 * altogether) is not express consent to mail this address.
 */
export function consentFromPayload(payload: CustomerWebhookPayload): ShopifyConsentRow | null {
  const email = payload.email?.trim()
  if (!email) return null

  const state = payload.email_marketing_consent?.state
  if (state !== 'subscribed') return null

  const locale = localeFromShopify(payload.locale)
  const consentedAt = Date.parse(payload.email_marketing_consent?.consent_updated_at ?? '')

  return {
    email: normalizeEmail(email),
    locale,
    consentText: SHOPIFY_CHECKOUT_CONSENT[locale],
    consentVersion: SHOPIFY_CONSENT_VERSION,
    consentedAt: Number.isNaN(consentedAt) ? Date.now() : consentedAt,
  }
}
