import { describe, expect, it } from 'vitest'
import {
  EMAIL_THEME,
  renderEmailShell,
  renderEmailText,
  sendConfirmationEmail,
  sendOrderConfirmationEmail,
  styleMarkdownHtml,
} from '../src/lib/email'
import { SENDER_IDENTITY } from '../src/lib/consent'

describe('sendConfirmationEmail', () => {
  it('fails instead of pretending to send when no API key is configured', async () => {
    const res = await sendConfirmationEmail({
      apiKey: undefined,
      to: 'someone@example.com',
      locale: 'fr-CA',
      siteUrl: 'https://nuageathletics.com',
      token: 'deadbeef',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/RESEND_API_KEY/)
  })
})

describe('sendOrderConfirmationEmail', () => {
  it('fails instead of pretending to send when no API key is configured', async () => {
    const res = await sendOrderConfirmationEmail({
      apiKey: undefined,
      to: 'someone@example.com',
      locale: 'fr-CA',
      siteUrl: 'https://nuageathletics.com',
      amountTotal: 12000,
      currency: 'cad',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/RESEND_API_KEY/)
  })
})

/**
 * EMAIL_THEME is a hand-copied snapshot of src/styles/global.css — email
 * can't reference CSS custom properties, so there is nothing enforcing that
 * the copy stays accurate except this test.
 *
 * This asserts against literals rather than parsing global.css directly:
 * the Workers pool this suite runs under (@cloudflare/vitest-pool-workers,
 * see vitest.config.ts) sandboxes the filesystem, so neither `node:fs` nor a
 * Vite `?raw` import can reach the real file from here. If you change a
 * token in global.css, update both this test and EMAIL_THEME together.
 */
describe('EMAIL_THEME', () => {
  it('matches the site tokens in src/styles/global.css', () => {
    expect(EMAIL_THEME.ink).toBe('#0a0a0a') // --color-ink
    expect(EMAIL_THEME.paper).toBe('#fafafa') // --color-paper
    expect(EMAIL_THEME.mute).toBe('#63696e') // --color-mute
    expect(EMAIL_THEME.line).toBe('#dcdcdc') // --color-line
    expect(EMAIL_THEME.accentInk).toBe('#3a5fd9') // --color-accent-ink
    expect(EMAIL_THEME.trackingLabel).toBe('0.18em') // --tracking-label
  })
})

describe('renderEmailShell', () => {
  const base = {
    locale: 'en-CA' as const,
    siteUrl: 'https://nuageathletics.com',
    heading: 'Heading',
    bodyHtml: '<p>Body</p>',
  }

  it('always includes the CASL sender identity block', () => {
    const html = renderEmailShell(base)
    expect(html).toContain(SENDER_IDENTITY.name)
    expect(html).toContain(SENDER_IDENTITY.address)
    expect(html).toContain(SENDER_IDENTITY.email)
  })

  it('includes the unsubscribe link when unsubUrl is given', () => {
    const unsubUrl = 'https://nuageathletics.com/api/unsubscribe?token=abc'
    const html = renderEmailShell({ ...base, unsubUrl })
    expect(html).toContain(unsubUrl)
  })

  it('omits an unsubscribe link when unsubUrl is not given', () => {
    const html = renderEmailShell(base)
    expect(html).not.toContain('/api/unsubscribe')
  })

  it('never sets a non-zero border-radius — this site has no radii', () => {
    const html = renderEmailShell({ ...base, unsubUrl: 'https://x/y' })
    expect(html).not.toMatch(/border-radius:\s*[^0][^;"']*/)
  })

  it('carries the wordmark image with brand alt text for images-off inboxes', () => {
    const html = renderEmailShell(base)
    expect(html).toContain('/img/wordmark-email.png')
    expect(html).toContain('alt="Nuage Athletics"')
  })
})

describe('renderEmailText', () => {
  it('includes the CASL sender identity block and the unsubscribe url', () => {
    const unsubUrl = 'https://nuageathletics.com/api/unsubscribe?token=abc'
    const text = renderEmailText({ heading: 'Heading', bodyText: 'Body', unsubUrl })
    expect(text).toContain(SENDER_IDENTITY.name)
    expect(text).toContain(SENDER_IDENTITY.address)
    expect(text).toContain(SENDER_IDENTITY.email)
    expect(text).toContain(unsubUrl)
  })
})

describe('styleMarkdownHtml', () => {
  it('inlines a style onto paragraphs and links', () => {
    const styled = styleMarkdownHtml('<p>Hello <a href="https://x">link</a></p>')
    expect(styled).toMatch(/<p style="[^"]+">/)
    expect(styled).toMatch(/<a style="[^"]+" href="https:\/\/x">/)
  })
})
