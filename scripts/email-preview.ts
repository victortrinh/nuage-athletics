/**
 * Renders every outbound email to local .html/.txt files, in both locales,
 * without needing a Resend account or a live D1 database.
 *
 * Usage:
 *   npm run email:preview
 *   npm run email:preview -- path/to/broadcast.md
 *
 * This is how the branded shell gets eyeballed: `broadcast.ts --dry-run`
 * only prints headers, never the rendered body, and there is no page in this
 * app that renders these templates (Astro's own preview is for site pages,
 * not outbound mail). Output goes to a gitignored scratch directory printed
 * at the end — open the .html files directly in a browser.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { marked } from 'marked'
import { LOCALES } from '../src/i18n/config.ts'
import {
  renderEmailShell,
  renderEmailText,
  styleMarkdownHtml,
  confirmationBodyHtml,
} from '../src/lib/email.ts'
import { UI } from '../src/i18n/ui.ts'

const SITE_URL = process.env.PUBLIC_SITE_URL ?? 'https://nuageathletics.com'
const OUT_DIR = 'tmp/email-preview'
const FAKE_TOKEN = 'preview0000000000000000000000000'

mkdirSync(OUT_DIR, { recursive: true })

function write(name: string, html: string, text: string) {
  writeFileSync(`${OUT_DIR}/${name}.html`, html)
  writeFileSync(`${OUT_DIR}/${name}.txt`, text)
  console.log(`wrote ${OUT_DIR}/${name}.html + .txt`)
}

for (const locale of LOCALES) {
  const d = UI[locale]
  const confirmUrl = `${SITE_URL}/api/confirm?token=${FAKE_TOKEN}`
  const unsubUrl = `${SITE_URL}/api/unsubscribe?token=${FAKE_TOKEN}`

  const confirmationHtml = renderEmailShell({
    locale,
    siteUrl: SITE_URL,
    heading: d.mailHeading,
    preheader: d.mailBody,
    bodyHtml: confirmationBodyHtml(d, confirmUrl),
    unsubUrl,
  })
  const confirmationText = renderEmailText({
    heading: d.mailHeading,
    bodyText: `${d.mailBody}\n\n${d.mailCta}: ${confirmUrl}\n\n${d.mailIgnore}`,
    unsubUrl,
  })
  write(`confirmation-${locale}`, confirmationHtml, confirmationText)
}

const broadcastFile = process.argv[2]
if (broadcastFile) {
  const raw = readFileSync(broadcastFile, 'utf-8')
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!frontmatterMatch) throw new Error('Broadcast markdown must start with --- frontmatter.')
  const [, frontmatter, body] = frontmatterMatch
  const subjectFr = frontmatter.match(/^subjectFr:\s*(.+)$/m)?.[1]?.trim() ?? '(no subjectFr)'
  const subjectEn = frontmatter.match(/^subjectEn:\s*(.+)$/m)?.[1]?.trim() ?? '(no subjectEn)'
  const frMatch = body.match(/<!--\s*fr\s*-->([\s\S]*?)(?=<!--\s*en\s*-->|$)/)
  const enMatch = body.match(/<!--\s*en\s*-->([\s\S]*)/)

  for (const [locale, subject, match] of [
    ['fr-CA', subjectFr, frMatch],
    ['en-CA', subjectEn, enMatch],
  ] as const) {
    if (!match) continue
    const bodyMarkdown = match[1].trim()
    const unsubUrl = `${SITE_URL}/api/unsubscribe?token=${FAKE_TOKEN}`
    const html = renderEmailShell({
      locale,
      siteUrl: SITE_URL,
      heading: subject,
      bodyHtml: styleMarkdownHtml(marked.parse(bodyMarkdown) as string),
      unsubUrl,
    })
    const text = renderEmailText({ heading: subject, bodyText: bodyMarkdown, unsubUrl })
    write(`broadcast-${locale}`, html, text)
  }
}

console.log(`\nDone. Open the .html files in ${OUT_DIR}/ in a browser.`)
