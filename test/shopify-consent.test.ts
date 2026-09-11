import { describe, expect, it } from 'vitest'
import {
  consentFromPayload,
  localeFromShopify,
  normalizeEmail,
} from '../src/lib/commerce/shopify-consent'
import { SHOPIFY_CHECKOUT_CONSENT, SHOPIFY_CONSENT_VERSION, CONSENT_VERSION } from '../src/lib/consent'

describe('localeFromShopify', () => {
  it('maps fr-prefixed values to fr-CA', () => {
    expect(localeFromShopify('fr-CA')).toBe('fr-CA')
    expect(localeFromShopify('fr')).toBe('fr-CA')
    expect(localeFromShopify('fr-FR')).toBe('fr-CA')
    expect(localeFromShopify('FR')).toBe('fr-CA')
  })

  it('falls back to en-CA for anything else, including missing values', () => {
    expect(localeFromShopify('en')).toBe('en-CA')
    expect(localeFromShopify('en-CA')).toBe('en-CA')
    expect(localeFromShopify('')).toBe('en-CA')
    expect(localeFromShopify(null)).toBe('en-CA')
    expect(localeFromShopify(undefined)).toBe('en-CA')
    expect(localeFromShopify('de')).toBe('en-CA')
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Buyer@Example.com ')).toBe('buyer@example.com')
  })
})

describe('consentFromPayload', () => {
  function payload(overrides: {
    email?: string | null
    locale?: string | null
    email_marketing_consent?: Record<string, unknown>
  } = {}) {
    const { email_marketing_consent, ...rest } = overrides
    return {
      email: 'buyer@example.com',
      locale: 'fr-CA',
      ...rest,
      email_marketing_consent: {
        state: 'subscribed',
        opt_in_level: 'single_opt_in',
        consent_updated_at: '2026-09-01T12:00:00Z',
        ...email_marketing_consent,
      },
    }
  }

  it('builds a row for an active subscribed state', () => {
    const row = consentFromPayload(payload())
    expect(row).not.toBeNull()
    expect(row?.email).toBe('buyer@example.com')
    expect(row?.locale).toBe('fr-CA')
    expect(row?.consentText).toBe(SHOPIFY_CHECKOUT_CONSENT['fr-CA'])
    expect(row?.consentVersion).toBe(SHOPIFY_CONSENT_VERSION)
    // Never the site's own version/text — a different wording needs its own
    // version, per CLAUDE.md's consent rule.
    expect(row?.consentVersion).not.toBe(CONSENT_VERSION)
    expect(row?.consentedAt).toBe(Date.parse('2026-09-01T12:00:00Z'))
  })

  it('normalizes the email', () => {
    const row = consentFromPayload(payload({ email: '  Buyer@Example.com ' }))
    expect(row?.email).toBe('buyer@example.com')
  })

  it('picks the wording by locale', () => {
    const row = consentFromPayload(payload({ locale: 'en' }))
    expect(row?.locale).toBe('en-CA')
    expect(row?.consentText).toBe(SHOPIFY_CHECKOUT_CONSENT['en-CA'])
  })

  it('returns null for every non-subscribed state', () => {
    for (const state of ['pending', 'not_subscribed', 'unsubscribed', 'invalid', 'redacted']) {
      expect(
        consentFromPayload(payload({ email_marketing_consent: { state } }))
      ).toBeNull()
    }
  })

  it('returns null when email_marketing_consent is missing entirely', () => {
    expect(consentFromPayload({ email: 'buyer@example.com', locale: 'fr-CA' })).toBeNull()
  })

  it('returns null for a missing or blank email', () => {
    expect(consentFromPayload(payload({ email: null }))).toBeNull()
    expect(consentFromPayload(payload({ email: '' }))).toBeNull()
    expect(consentFromPayload(payload({ email: '   ' }))).toBeNull()
  })

  it('falls back to now when consent_updated_at is missing or unparseable', () => {
    const before = Date.now()
    const row = consentFromPayload(
      payload({ email_marketing_consent: { state: 'subscribed', consent_updated_at: 'not-a-date' } })
    )
    const after = Date.now()
    expect(row?.consentedAt).toBeGreaterThanOrEqual(before)
    expect(row?.consentedAt).toBeLessThanOrEqual(after)

    const rowMissing = consentFromPayload(
      payload({ email_marketing_consent: { state: 'subscribed', consent_updated_at: undefined } })
    )
    expect(rowMissing?.consentedAt).toBeGreaterThanOrEqual(before)
  })
})
