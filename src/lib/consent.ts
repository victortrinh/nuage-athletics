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
