import { describe, expect, it } from 'vitest'
import {
  EMAIL_THEME,
  EMAIL_THEME_DARK,
  renderEmailShell,
  renderEmailText,
  sendConfirmationEmail,
  styleMarkdownHtml,
} from '../src/lib/email'
import { SENDER_IDENTITY } from '../src/lib/consent'

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

/**
 * scripts/email-wordmark.mjs bakes DARK_INK/DARK_PAPER literals into
 * wordmark-email-dark.png — this pins those against EMAIL_THEME_DARK the
 * same way EMAIL_THEME's test above pins the light asset, so the two can't
 * silently drift apart.
 */
describe('EMAIL_THEME_DARK', () => {
  it('matches the literals baked into wordmark-email-dark.png by email-wordmark.mjs', () => {
    expect(EMAIL_THEME_DARK.ink).toBe('#f2f2f0') // DARK_INK
    expect(EMAIL_THEME_DARK.paper).toBe('#161616') // DARK_PAPER
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
    expect(html).toContain('bgcolor="#e8e8e6"')
  })

  it('centers content — table-cell text-align doesn\'t reliably inherit down nested tables', () => {
    const html = renderEmailShell(base)
    // Every cell that holds text gets its own text-align:center rather than
    // relying on one ancestor declaration to cascade through every nested
    // <table>.
    const centeredCells = html.match(/text-align:center/g) ?? []
    expect(centeredCells.length).toBeGreaterThanOrEqual(4)
  })

  it('declares both colour schemes rather than opting out of dark mode', () => {
    const html = renderEmailShell(base)
    // Not "light only" — see the doc comment on EMAIL_THEME_DARK. Clients
    // like Outlook.com auto-dark-mode a message regardless of that opt-out,
    // so the fix is to actually declare a dark theme rather than ask to be
    // left alone.
    expect(html).toContain('content="light dark"')
    expect(html).toContain('@media (prefers-color-scheme: dark)')
  })

  it('overrides every themed colour under the dark media query, not just the card', () => {
    const html = renderEmailShell({ ...base, unsubUrl: 'https://x/y' })
    const darkBlock = html.match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\}\s*<\/style>/)?.[1] ?? ''
    for (const [cls, value] of [
      ['.email-outer-bg', '#0d0d0d'],
      ['.email-card', EMAIL_THEME_DARK.paper],
      ['.email-ink', EMAIL_THEME_DARK.ink],
      ['.email-mute', EMAIL_THEME_DARK.mute],
      ['.email-line', EMAIL_THEME_DARK.line],
    ]) {
      expect(darkBlock).toContain(cls)
      expect(darkBlock).toContain(value)
    }
  })

  it('repeats every dark rule under Outlook\'s data-ogsc/data-ogsb hooks', () => {
    const html = renderEmailShell(base)
    // Outlook.com and the new Outlook apps never evaluate the media query;
    // they auto-invert and stamp these attributes on what they recoloured.
    // The logo swap in particular has to fire there, or the light wordmark's
    // paper ground sits as a white box on their grey card.
    const mediaBlock = html.match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n      \}/)?.[1] ?? ''
    const rules = mediaBlock.trim().split('\n').map((l) => l.trim())
    expect(rules.length).toBeGreaterThanOrEqual(8)
    for (const rule of rules) {
      const [sel, decl] = rule.split(/ \{ /)
      expect(html).toContain(`[data-ogsc] ${sel}, [data-ogsb] ${sel} { ${decl}`)
    }
    expect(html).toContain('[data-ogsc] .email-logo-dark, [data-ogsb] .email-logo-dark { display: block !important; }')
    expect(html).toContain('[data-ogsc] .email-logo-light, [data-ogsb] .email-logo-light { display: none !important; }')
  })

  it('swaps the wordmark for a dark-safe asset instead of relying on transparency', () => {
    const html = renderEmailShell(base)
    expect(html).toContain('/img/wordmark-email-dark.png')
    expect(html).toContain('class="email-logo-light"')
    expect(html).toContain('class="email-logo-dark"')
    // Hidden by default so clients that ignore the media query still show
    // the light-mode wordmark rather than nothing.
    expect(html).toMatch(/class="email-logo-dark"[^>]*style="display:none/)
  })

  it('floats the dark card on a dark sky backdrop too', () => {
    const html = renderEmailShell(base)
    expect(html).toContain('/img/email-sky-dark.png')
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
    expect(styled).toMatch(/<p class="email-ink" style="[^"]+">/)
    expect(styled).toMatch(/<a class="email-accent" style="[^"]+" href="https:\/\/x">/)
  })
})
