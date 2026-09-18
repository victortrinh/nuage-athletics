/**
 * Generates the committed Shopify notification templates
 * (shopify/notifications/*.liquid) from the TypeScript sources in
 * shopify/src/ — see that directory's own doc comments and
 * shopify/notifications/README.md for why generation exists (Shopify
 * notifications have no way to share a partial between templates) and how
 * a human pastes the output into the admin.
 *
 * Usage:
 *   npm run shopify:notifications             -- write shopify/notifications/*
 *   npm run shopify:notifications -- --check  -- fail if committed files are
 *                                                 stale, or fail a lint pass
 *   npm run shopify:notifications -- --preview -- render each template with
 *                                                  fixture data into
 *                                                  tmp/shopify-notifications/
 *
 * --check is wired into `npm run check` (package.json) — same role
 * scripts/check-guards.sh plays for src/, since that script's greps are
 * scoped to src/ and never see this directory.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Liquid } from 'liquidjs'
import { NOTIFICATION_TEMPLATES } from '../shopify/src/templates/index.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = resolve(REPO_ROOT, 'shopify/notifications')
const PREVIEW_DIR = resolve(REPO_ROOT, 'tmp/shopify-notifications')

const args = process.argv.slice(2)
const mode = args.includes('--check') ? 'check' : args.includes('--preview') ? 'preview' : 'write'

function outputs(): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = []
  for (const tpl of NOTIFICATION_TEMPLATES) {
    files.push({ path: resolve(OUT_DIR, `${tpl.file}.liquid`), content: tpl.html })
    // A template may deliberately ship no subject — see NotificationTemplate.
    if (tpl.subject !== undefined) {
      files.push({ path: resolve(OUT_DIR, `${tpl.file}.subject.liquid`), content: tpl.subject })
    }
  }
  return files
}

/**
 * Cheap, precise lint pass — the shopify/ equivalent of
 * scripts/check-guards.sh, which only greps src/ and never sees this
 * directory. Each rule guards a specific decision from #91 / CLAUDE.md.
 */
function lint(): string[] {
  const problems: string[] = []
  for (const tpl of NOTIFICATION_TEMPLATES) {
    const html = tpl.html
    const label = tpl.file

    if (/border-radius:\s*(?!0(px)?\s*;)[^;]+;/.test(html)) {
      problems.push(`${label}: non-zero border-radius — this site has no radii (see global.css)`)
    }
    if (/var\(/.test(html)) {
      problems.push(`${label}: uses CSS var() — mail clients strip/ignore custom properties (see EMAIL_THEME)`)
    }
    if (/\{\{\s*shop\.url/.test(html)) {
      problems.push(`${label}: references shop.url — that's the dead Online Store channel (#88/#90); use the hardcoded SITE_URL`)
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
      problems.push(`${label}: ${opens} '{% if en %}' branch(es) but ${elses} '{% else %}' — every t() call must carry both locales`)
    }
    const hasUnsub = html.includes('unsubscribe_url')
    const shouldHaveUnsub = tpl.file === 'abandoned-checkout'
    if (hasUnsub !== shouldHaveUnsub) {
      problems.push(
        `${label}: ${shouldHaveUnsub ? 'missing' : 'unexpected'} unsubscribe_url — only the abandoned-checkout template is marketing under CASL`
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
    console.error(
      '\nRun `npm run shopify:notifications` and commit the result, or fix the source in shopify/src/.'
    )
    process.exit(1)
  }
  console.log(`✓ ${files.length} generated files match shopify/notifications/, lint clean`)
}

function runWrite() {
  mkdirSync(OUT_DIR, { recursive: true })
  for (const { path, content } of outputs()) {
    writeFileSync(path, content + '\n')
  }
  console.log(`Wrote ${outputs().length} files to shopify/notifications/`)
}

/**
 * Renders each template through a real Liquid engine with fixture order /
 * fulfillment / checkout / refund data, in both locales, so the HTML/CSS
 * and copy can be eyeballed in a browser — the shopify/ equivalent of
 * scripts/email-preview.ts. This is not a Shopify renderer: it proves the
 * markup and the bilingual branching, not that Shopify's real variable
 * names match (that's the "Send test" step in the README).
 */
async function runPreview() {
  mkdirSync(PREVIEW_DIR, { recursive: true })
  const engine = new Liquid()
  engine.registerFilter('money', (v: number) => `$${(v / 100).toFixed(2)}`)
  engine.registerFilter('money_with_currency', (v: number) => `$${(v / 100).toFixed(2)} CAD`)
  engine.registerFilter('format_address', (a: Record<string, string>) =>
    a ? `${a.address1}<br />${a.city} ${a.province_code} ${a.zip}<br />${a.country}` : ''
  )

  const lineItem = (title: string, variant: string, qty: number, cents: number) => ({
    title,
    variant_title: variant,
    quantity: qty,
    final_line_price: cents,
    subtotal: cents,
  })
  const address = {
    first_name: 'Camille',
    address1: '123 Rue Test',
    city: 'Montréal',
    province_code: 'QC',
    zip: 'H2X 1Y4',
    country: 'Canada',
  }
  const fulfillment = {
    tracking_company: 'Postes Canada',
    tracking_number: '1234567890',
    tracking_url: 'https://example.com/track/1234567890',
    estimated_delivery_at: '2026-10-05',
    fulfillment_line_items: [{ line_item: lineItem('T-shirt manches longues', 'Classique / M', 1, 8500), quantity: 1 }],
  }

  for (const locale of ['fr-CA', 'en-CA'] as const) {
    const customerLocale = locale === 'en-CA' ? 'en' : 'fr'
    const ctx = {
      order_name: '#1042',
      order_status_url: 'https://nuage-athletics-dev.myshopify.com/orders/abc123',
      customer: { first_name: 'Camille', locale: customerLocale },
      customer_locale: customerLocale,
      order: { customer_locale: customerLocale },
      checkout: { customer_locale: customerLocale },
      email: 'camille@example.com',
      line_items: [
        lineItem('T-shirt manches longues', 'Classique / M', 1, 8500),
        lineItem('Short technique', 'Coupe ample / L', 2, 5500),
      ],
      refund_line_items: [{ line_item: lineItem('Short technique', 'Coupe ample / L', 1, 5500), quantity: 1 }],
      amount: 5500,
      subtotal_price: 19500,
      total_discounts: 0,
      total_price: 19500,
      shipping_address: address,
      billing_address: address,
      shipping_method: { title: 'Postes Canada', price: 0 },
      tax_lines: [],
      fulfillment,
      fulfillment_event: { message: 'Retard signalé par le transporteur.' },
      url: 'https://nuage-athletics-dev.myshopify.com/checkouts/abc123',
      // contact-customer / order-invoice: the message typed in the admin
      // dialog, and an unpaid order's payment link.
      custom_message:
        customerLocale === 'en'
          ? 'Your parcel went out this morning.\n\nCanada Post has it now — tracking below.'
          : 'Votre colis est parti ce matin.\n\nPostes Canada l’a maintenant — suivi ci-dessous.',
      invoice_url: 'https://nuage-athletics-dev.myshopify.com/invoices/abc123',
      unsubscribe_url: 'https://nuage-athletics-dev.myshopify.com/unsubscribe/abc123',
      shop: { address: { summary: '123 Rue Test, Montréal QC H2X 1Y4' } },
    }
    for (const tpl of NOTIFICATION_TEMPLATES) {
      const html = await engine.parseAndRender(tpl.html, ctx)
      const subject = tpl.subject === undefined ? null : await engine.parseAndRender(tpl.subject, ctx)
      const out = resolve(PREVIEW_DIR, `${tpl.file}.${locale}.html`)
      const header =
        subject === null
          ? '<!-- Subject: (Shopify\'s own, typed per message — not generated) -->'
          : `<!-- Subject: ${subject.trim()} -->`
      writeFileSync(out, `${header}\n${html}`)
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
