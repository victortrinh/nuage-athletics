import { describe, expect, it } from 'vitest'
import { PRINT_THEME, PRINT_WORDMARK_PATH } from '../shopify/src/print/theme'
import { PRINT_TEMPLATES } from '../shopify/src/print/index'
import { EMAIL_THEME, OUTER_BG } from '../src/lib/email'
import { SENDER_IDENTITY } from '../src/lib/consent'

/**
 * The print counterpart to test/email.test.ts's EMAIL_THEME block, and for
 * the same reason: PRINT_THEME.ink is baked into
 * public/img/wordmark-print.png by scripts/print-wordmark.mjs — a literal
 * hex in a script nothing else imports. This pins the export against it so
 * the mark and the type it sits above can't silently drift apart. (It
 * asserts against literals rather than reading the script: the Workers pool
 * this suite runs under sandboxes the filesystem.) Change the colour in one
 * place, update both.
 */
describe('PRINT_THEME', () => {
  it('matches the literal baked into the print asset', () => {
    expect(PRINT_THEME.ink).toBe('#0a0a0a') // print-wordmark.mjs INK
    expect(PRINT_WORDMARK_PATH).toBe('/img/wordmark-print.png')
  })

  it('is ink on paper — the inverse of the email palette, not a copy of it', () => {
    // The whole point of the split (see PRINT_THEME's doc comment). Email is
    // dark because clients invert light backgrounds; paper has no inverter
    // and a dark sheet is just toner.
    const lum = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b) / 3
    expect(lum(PRINT_THEME.ink)).toBeLessThan(64)
    expect(lum(PRINT_THEME.paper)).toBeGreaterThan(192)
    // And genuinely the other way round from the email pair.
    expect(lum(PRINT_THEME.ink)).toBeLessThan(lum(EMAIL_THEME.ink))
    expect(lum(PRINT_THEME.paper)).toBeGreaterThan(lum(EMAIL_THEME.paper))
  })

  it('paints no page ground, so a slip costs one order of toner and not a cartridge', () => {
    expect(PRINT_THEME.paper).toBe('#ffffff')
  })
})

/**
 * These duplicate scripts/shopify-print.ts's lint rules on purpose. The lint
 * runs in `npm run check`; this runs in `npm test`. The rules they share are
 * the ones where a regression is silent and expensive — a dark sheet, a
 * missing footer, a half-translated document — and a contributor who runs
 * only one of the two commands should still be stopped.
 */
describe('packing slip', () => {
  const slip = PRINT_TEMPLATES.find((t) => t.file === 'packing-slip')!

  it('exists and is the only print document so far', () => {
    expect(slip).toBeDefined()
    expect(PRINT_TEMPLATES).toHaveLength(1)
  })

  it('carries none of the email palette', () => {
    for (const hex of [EMAIL_THEME.paper, EMAIL_THEME.ink, EMAIL_THEME.line, OUTER_BG]) {
      expect(slip.html.toLowerCase()).not.toContain(hex.toLowerCase())
    }
  })

  it('identifies the sender the way ADR-0007 requires', () => {
    expect(slip.html).toContain('{{ shop.address.summary }}')
    expect(slip.html).toContain(SENDER_IDENTITY.email)
    expect(slip.html).toContain(SENDER_IDENTITY.name)
  })

  it('never references the dead Online Store channel', () => {
    expect(slip.html).not.toMatch(/\{\{\s*shop\.url/)
  })

  it('is bilingual in every branch, French as the fallback', () => {
    const opens = slip.html.match(/\{% ?if en ?%\}/g) ?? []
    const elses = slip.html.match(/\{% ?else ?%\}/g) ?? []
    expect(opens.length).toBeGreaterThan(0)
    expect(opens).toHaveLength(elses.length)
    // LOCALE_PRELUDE's `| default: 'fr'` is what makes French the fallback;
    // assert the prelude is present rather than restating its internals.
    expect(slip.html).toContain("default: 'fr'")
  })

  it('has no unsubscribe link and no button — it is a sheet of paper', () => {
    expect(slip.html).not.toContain('unsubscribe')
    expect(slip.html).not.toContain('email-btn')
  })

  it('shows no prices', () => {
    // See packing-slip.ts's doc comment: the buyer already has a priced
    // confirmation, and a priced slip prices a gift for whoever opens it.
    expect(slip.html).not.toContain('| money')
    expect(slip.html).not.toContain('total_price')
  })

  it('prints the SKU, which is what a fit and size are checked against', () => {
    expect(slip.html).toContain('line_item.sku')
  })
})
