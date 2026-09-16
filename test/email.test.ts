import { describe, expect, it } from 'vitest'
import {
  EMAIL_THEME,
  confirmationBodyHtml,
  renderEmailShell,
  renderEmailText,
  sendConfirmationEmail,
  styleMarkdownHtml,
} from '../src/lib/email'
import { SENDER_IDENTITY } from '../src/lib/consent'
import { UI } from '../src/i18n/ui'

const TEST_ADDRESS = '123 Rue Exemple, Montréal QC H2X 1Y4'

describe('sendConfirmationEmail', () => {
  it('fails instead of pretending to send when no API key is configured', async () => {
    const res = await sendConfirmationEmail({
      apiKey: undefined,
      address: TEST_ADDRESS,
      to: 'someone@example.com',
      locale: 'fr-CA',
      siteUrl: 'https://nuageathletics.com',
      token: 'deadbeef',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/RESEND_API_KEY/)
  })

  it('fails instead of pretending to send when no mailing address is configured', async () => {
    const res = await sendConfirmationEmail({
      apiKey: 'test-key',
      address: undefined,
      to: 'someone@example.com',
      locale: 'fr-CA',
      siteUrl: 'https://nuageathletics.com',
      token: 'deadbeef',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/SENDER_ADDRESS/)
  })

  it('treats a whitespace-only mailing address as not configured', async () => {
    const res = await sendConfirmationEmail({
      apiKey: 'test-key',
      address: '   ',
      to: 'someone@example.com',
      locale: 'fr-CA',
      siteUrl: 'https://nuageathletics.com',
      token: 'deadbeef',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/SENDER_ADDRESS/)
  })
})

/**
 * EMAIL_THEME.ink / .paper are baked into public/img/wordmark-email.png by
 * scripts/email-wordmark.mjs, and OUTER_BG into email-sky.png by
 * scripts/email-sky-bg.mjs — literal hexes in scripts nothing else imports.
 * This pins the exports against those literals so the card and the image
 * sitting on it can't silently drift apart. (It asserts against literals
 * rather than reading the scripts: the Workers pool this suite runs under —
 * @cloudflare/vitest-pool-workers, see vitest.config.ts — sandboxes the
 * filesystem.) Change a colour in one place, update all three.
 */
describe('EMAIL_THEME', () => {
  it('matches the literals baked into the email assets', () => {
    expect(EMAIL_THEME.ink).toBe('#f2f2f0') // email-wordmark.mjs INK
    expect(EMAIL_THEME.paper).toBe('#161616') // email-wordmark.mjs PAPER
    expect(EMAIL_THEME.trackingLabel).toBe('0.18em') // --tracking-label
  })

  it('is dark, not a copy of the site tokens', () => {
    // The whole point of the palette — see the doc comment on EMAIL_THEME.
    // A light card is what clients' dark-mode inverters rewrite; a dark one
    // is what they all leave alone.
    const lum = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b) / 3
    expect(lum(EMAIL_THEME.paper)).toBeLessThan(64)
    expect(lum(EMAIL_THEME.ink)).toBeGreaterThan(192)
  })
})

describe('renderEmailShell', () => {
  const base = {
    locale: 'en-CA' as const,
    siteUrl: 'https://nuageathletics.com',
    heading: 'Heading',
    bodyHtml: '<p>Body</p>',
    address: TEST_ADDRESS,
  }

  it('always includes the CASL sender identity block', () => {
    const html = renderEmailShell(base)
    expect(html).toContain(SENDER_IDENTITY.name)
    expect(html).toContain(TEST_ADDRESS)
    expect(html).toContain(SENDER_IDENTITY.email)
  })

  it('escapes the mailing address before rendering it as HTML', () => {
    const html = renderEmailShell({ ...base, address: '1 Rue A & B' })
    expect(html).toContain('1 Rue A &amp; B')
    expect(html).not.toContain('1 Rue A & B<br')
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

  it('floats the card on the sky backdrop, with a solid colour Outlook can fall back to', () => {
    const html = renderEmailShell(base)
    expect(html).toContain('/img/email-sky.png')
    // The legacy HTML attribute, not just the CSS — Outlook's Word engine
    // ignores background-image in style= entirely.
    expect(html).toMatch(/background="[^"]*email-sky\.png"/)
    expect(html).toContain('bgcolor="#0d0d0d"')
  })

  it('centers content — table-cell text-align doesn\'t reliably inherit down nested tables', () => {
    const html = renderEmailShell(base)
    // Every cell that holds text gets its own text-align:center rather than
    // relying on one ancestor declaration to cascade through every nested
    // <table>.
    const centeredCells = html.match(/text-align:center/g) ?? []
    expect(centeredCells.length).toBeGreaterThanOrEqual(4)
  })

  it('renders one dark theme with nothing for most of the shell to switch', () => {
    const html = renderEmailShell(base)
    // Not "light only" — Outlook.com and Gmail mobile auto-dark-mode a
    // message regardless of that opt-out. See EMAIL_THEME.
    expect(html).toContain('content="light dark"')
    // Apple Mail 13+ ignores the meta pair alone and auto-inverts without
    // this CSS property present somewhere — see the doc comment above
    // renderEmailShell. A `:root` rule would need a <style> block; the
    // inline attribute on <html> has the same effect without one.
    expect(html).toMatch(/<html[^>]*style="[^"]*color-scheme:\s*light dark/)
    expect(html).not.toContain('prefers-color-scheme')
    expect(html).toContain(`bgcolor="${EMAIL_THEME.paper}"`)
    expect(html).toContain('bgcolor="#0d0d0d"')
  })

  it('re-asserts the CTA button\'s colours against Outlook\'s auto-invert', () => {
    // The button is the one light-background element in an otherwise dark
    // shell (contrast on purpose) — exactly what Outlook.com/the Outlook
    // mobile apps auto-darken, stamping data-ogsc/data-ogsb on what they
    // recoloured. This is the one place the shell still needs a <style>
    // block; nothing else in it is conditional. See the doc comment on
    // EMAIL_THEME.
    const html = renderEmailShell({
      ...base,
      bodyHtml: confirmationBodyHtml(UI['en-CA'], 'https://nuageathletics.com/api/confirm?token=x'),
    })
    expect(html).toMatch(/<style>[\s\S]*\[data-ogsc\] \.email-btn[\s\S]*<\/style>/)
    expect(html).toMatch(/\[data-ogsc\] \.email-btn, \[data-ogsb\] \.email-btn \{[^}]*background-color:\s*#f2f2f0 !important;[^}]*color:\s*#161616 !important;/)
    expect(html).toContain('class="email-btn"')
  })

  it('ships exactly one wordmark, on the card\'s own ground', () => {
    const html = renderEmailShell(base)
    expect(html.match(/wordmark-email/g)).toHaveLength(1)
    expect(html).toContain('/img/wordmark-email.png')
    expect(html).not.toContain('wordmark-email-dark')
    expect(html).toContain('/img/email-sky.png')
    expect(html).not.toContain('email-sky-dark')
  })
})

describe('renderEmailText', () => {
  it('includes the CASL sender identity block and the unsubscribe url', () => {
    const unsubUrl = 'https://nuageathletics.com/api/unsubscribe?token=abc'
    const text = renderEmailText({
      heading: 'Heading',
      bodyText: 'Body',
      unsubUrl,
      address: TEST_ADDRESS,
    })
    expect(text).toContain(SENDER_IDENTITY.name)
    expect(text).toContain(TEST_ADDRESS)
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
