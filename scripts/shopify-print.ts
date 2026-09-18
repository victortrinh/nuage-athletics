/**
 * Generates the committed Shopify print documents (shopify/print/*.liquid)
 * from the TypeScript sources in shopify/src/print/ — the print-medium
 * sibling of scripts/shopify-notifications.ts.
 *
 * Usage:
 *   npm run shopify:print              -- write shopify/print/*
 *   npm run shopify:print -- --check   -- fail if committed files are stale,
 *                                          or fail the lint pass
 *   npm run shopify:print -- --preview -- render with fixture data into
 *                                          tmp/shopify-print/
 *
 * --check is wired into `npm run check`, same as the notifications one.
 *
 * ## Why this is a second script and not a flag on the first
 *
 * The two families share their Liquid primitives (shopify/src/liquid.ts) and
 * nothing else. They have different output directories, a different shell, a
 * different palette, no subject line here, and — the part that matters — a
 * different lint profile: several rules below are the *inverse* of the
 * notification ones. A packing slip that passed the email lint would be a
 * dark sheet of paper with an unsubscribe link on it. Folding both into one
 * `--kind` flag would mean one lint function with a mode argument, which is
 * how the two profiles drift into each other.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Liquid } from 'liquidjs'
import { PRINT_TEMPLATES } from '../shopify/src/print/index.ts'
import { EMAIL_THEME, OUTER_BG } from '../src/lib/email.ts'
import { PRINT_THEME } from '../shopify/src/print/theme.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = resolve(REPO_ROOT, 'shopify/print')
const PREVIEW_DIR = resolve(REPO_ROOT, 'tmp/shopify-print')

const args = process.argv.slice(2)
const mode = args.includes('--check') ? 'check' : args.includes('--preview') ? 'preview' : 'write'

function outputs(): { path: string; content: string }[] {
  return PRINT_TEMPLATES.map((tpl) => ({
    path: resolve(OUT_DIR, `${tpl.file}.liquid`),
    content: tpl.html,
  }))
}

/**
 * Print-specific lint. Shares four rules with the notification linter (no
 * radii, no `shop.url`, footer identification, bilingual parity) and then
 * diverges, because the two media want opposite things.
 */
function lint(): string[] {
  const problems: string[] = []

  /** Every dark literal the email side bakes in. A packing slip carrying any
   * of them is a block pasted across from shopify/src/ without its palette —
   * which prints as a black rectangle and empties a toner cartridge over a
   * few dozen orders. This is the rule that makes the print/email split
   * enforceable rather than a convention. */
  const DARK_LITERALS: [string, string][] = [
    [EMAIL_THEME.paper, 'EMAIL_THEME.paper'],
    [EMAIL_THEME.ink, 'EMAIL_THEME.ink'],
    [EMAIL_THEME.line, 'EMAIL_THEME.line'],
    [OUTER_BG, 'OUTER_BG'],
  ]

  for (const tpl of PRINT_TEMPLATES) {
    const html = tpl.html
    const label = tpl.file

    for (const [hex, name] of DARK_LITERALS) {
      if (html.toLowerCase().includes(hex.toLowerCase())) {
        problems.push(
          `${label}: contains ${name} (${hex}) — that is the email palette; print is ink on paper (see PRINT_THEME)`
        )
      }
    }
    if (/background(-color)?:\s*(?!none|transparent|inherit)[^;]+;/.test(html)) {
      problems.push(
        `${label}: paints a background — a printed sheet's ground is the paper (see PRINT_THEME.paper)`
      )
    }
    if (html.includes('unsubscribe')) {
      problems.push(`${label}: mentions unsubscribe — paper has no unsubscribe mechanism`)
    }
    if (html.includes('email-btn') || /<a\s[^>]*class="[^"]*btn/.test(html)) {
      problems.push(`${label}: carries a CTA button — nothing on a sheet of paper is clickable`)
    }
    if (!html.includes(PRINT_THEME.ink)) {
      problems.push(`${label}: never uses PRINT_THEME.ink (${PRINT_THEME.ink}) — is it actually inked?`)
    }

    // --- shared with the notification linter, same reasons ---
    if (/border-radius:\s*(?!0(px)?\s*;)[^;]+;/.test(html)) {
      problems.push(`${label}: non-zero border-radius — this site has no radii (see global.css)`)
    }
    if (/var\(/.test(html)) {
      problems.push(
        `${label}: uses CSS var() — nothing defines a custom property inside Shopify's print document`
      )
    }
    if (/\{\{\s*shop\.url/.test(html)) {
      problems.push(
        `${label}: references shop.url — that's the dead Online Store channel (#88/#90); use the hardcoded SITE_URL`
      )
    }
    if (!html.includes('{{ shop.address.summary }}')) {
      problems.push(`${label}: footer is missing shop.address — see CLAUDE.md ADR-0007`)
    }
    if (!html.includes('hello@nuageathletics.com')) {
      problems.push(`${label}: footer is missing hello@nuageathletics.com`)
    }
    if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(html)) {
      problems.push(`${label}: contains what looks like a phone number — none is published (ADR-0007)`)
    }
    const opens = (html.match(/\{% ?if en ?%\}/g) ?? []).length
    const elses = (html.match(/\{% ?else ?%\}/g) ?? []).length
    if (opens !== elses) {
      problems.push(
        `${label}: ${opens} '{% if en %}' branch(es) but ${elses} '{% else %}' — every t() call must carry both locales`
      )
    }
    if (!html.includes('<!-- na-locale:')) {
      problems.push(`${label}: missing the locale-prelude debug comment`)
    }
  }
  return problems
}

function runCheck() {
  const files = outputs()
  const problems = lint()
  let stale = false
  for (const { path, content } of files) {
    if (!existsSync(path)) {
      console.error(`✘ missing: ${path.replace(REPO_ROOT + '/', '')}`)
      stale = true
      continue
    }
    if (readFileSync(path, 'utf8') !== content + '\n') {
      console.error(`✘ stale: ${path.replace(REPO_ROOT + '/', '')}`)
      stale = true
    }
  }
  for (const p of problems) console.error(`✘ ${p}`)
  if (stale || problems.length) {
    console.error('\nRun `npm run shopify:print` and commit the result, or fix the source in shopify/src/print/.')
    process.exit(1)
  }
  console.log(`✓ ${files.length} generated file(s) match shopify/print/, lint clean`)
}

function runWrite() {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const { path, content } of outputs()) {
    writeFileSync(path, content + '\n')
  }
  console.log(`Wrote ${outputs().length} file(s) to shopify/print/`)
}

/**
 * Renders each document through a real Liquid engine with fixture order data,
 * in both locales, so the layout can be eyeballed in a browser and — the
 * point of a print document — sent to a printer or a Print-to-PDF before it
 * is ever pasted into Shopify. This is not a Shopify renderer: it proves the
 * markup and the bilingual branching, not that Shopify's real variable names
 * match (that's the runbook's field check).
 */
async function runPreview() {
  mkdirSync(PREVIEW_DIR, { recursive: true })
  const engine = new Liquid()
  engine.registerFilter('format_address', (a: Record<string, string>) =>
    a ? `${a.name}<br />${a.address1}<br />${a.city} ${a.province_code} ${a.zip}<br />${a.country}` : ''
  )

  const address = {
    name: 'Camille Tremblay',
    address1: '123 Rue Test',
    city: 'Montréal',
    province_code: 'QC',
    zip: 'H2X 1Y4',
    country: 'Canada',
  }

  for (const locale of ['fr-CA', 'en-CA'] as const) {
    const customerLocale = locale === 'en-CA' ? 'en' : 'fr'
    const ctx = {
      order: {
        name: '#1042',
        created_at: '2026-10-01',
        email: 'camille@example.com',
        customer_locale: customerLocale,
        shipping_address: address,
        note: locale === 'fr-CA' ? 'Sonner deux fois, merci.' : 'Please ring twice.',
      },
      line_items: [
        { title: 'T-shirt manches longues', variant_title: 'Classique / M', sku: 'ls-01-classic-m', quantity: 1 },
        { title: 'T-shirt manches longues', variant_title: 'Court / L', sku: 'ls-01-crop-l', quantity: 2 },
      ],
      shop: { address: { summary: '123 Rue Test, Montréal QC H2X 1Y4' } },
    }
    for (const tpl of PRINT_TEMPLATES) {
      const html = await engine.parseAndRender(tpl.html, ctx)
      writeFileSync(resolve(PREVIEW_DIR, `${tpl.file}.${locale}.html`), html)
    }
  }
  console.log(`Preview HTML written to ${PREVIEW_DIR.replace(REPO_ROOT + '/', '')}/`)
}

if (mode === 'check') {
  runCheck()
} else if (mode === 'preview') {
  await runPreview()
} else {
  runWrite()
}
