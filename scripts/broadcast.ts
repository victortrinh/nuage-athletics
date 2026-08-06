/**
 * Send a one-off broadcast email to every confirmed subscriber.
 *
 * Usage:
 *   node scripts/broadcast.ts <markdown-file> --dry-run
 *   RESEND_API_KEY=... node scripts/broadcast.ts <markdown-file> [--limit N]
 *
 * Always run --dry-run first. Sending for real requires RESEND_API_KEY and
 * the absence of --dry-run — there is no other confirmation prompt, so treat
 * the dry run as the only safety net before this reaches real inboxes.
 *
 * Reads confirmed subscribers straight from the remote D1 database via
 * `wrangler d1 execute --remote`, so it needs you to already be logged in
 * (`wrangler login`). Only ever selects status = 'confirmed' — pending and
 * unsubscribed rows are never touched.
 *
 * Markdown source format:
 *
 *   ---
 *   subjectFr: Sujet en français
 *   subjectEn: Subject in English
 *   ---
 *   <!-- fr -->
 *   Corps en **Markdown**...
 *
 *   <!-- en -->
 *   Body in **Markdown**...
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { marked } from 'marked'
import { renderEmailShell, RESEND_ENDPOINT } from '../src/lib/email.ts'
import { SENDER_IDENTITY } from '../src/lib/consent.ts'
import { isLocale, type Locale } from '../src/i18n/config.ts'

const SITE_URL = process.env.PUBLIC_SITE_URL ?? 'https://nuageathletics.com'
const BATCH_SIZE = 100
// Stay comfortably under Resend's rate limit between batches.
const BATCH_DELAY_MS = 600

interface Broadcast {
  subject: Record<Locale, string>
  bodyHtml: Record<Locale, string>
}

interface SubscriberRow {
  id: string
  email: string
  locale: string
  token: string
}

function parseArgs(argv: string[]) {
  const [file, ...rest] = argv
  if (!file) {
    console.error('Usage: node scripts/broadcast.ts <markdown-file> [--dry-run] [--limit N]')
    process.exit(1)
  }
  const dryRun = rest.includes('--dry-run')
  const limitIndex = rest.indexOf('--limit')
  const limit = limitIndex !== -1 ? Number(rest[limitIndex + 1]) : undefined
  return { file, dryRun, limit }
}

function parseBroadcastMarkdown(raw: string): Broadcast {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!frontmatterMatch) {
    throw new Error(
      'Markdown file must start with a --- frontmatter block containing subjectFr and subjectEn.'
    )
  }
  const [, frontmatter, body] = frontmatterMatch

  const subjectFr = frontmatter.match(/^subjectFr:\s*(.+)$/m)?.[1]?.trim()
  const subjectEn = frontmatter.match(/^subjectEn:\s*(.+)$/m)?.[1]?.trim()
  if (!subjectFr || !subjectEn) {
    throw new Error('Frontmatter must set both subjectFr and subjectEn.')
  }

  const frMatch = body.match(/<!--\s*fr\s*-->([\s\S]*?)(?=<!--\s*en\s*-->|$)/)
  const enMatch = body.match(/<!--\s*en\s*-->([\s\S]*)/)
  if (!frMatch || !enMatch) {
    throw new Error('Body must contain <!-- fr --> and <!-- en --> section markers.')
  }

  return {
    subject: { 'fr-CA': subjectFr, 'en-CA': subjectEn },
    bodyHtml: {
      'fr-CA': marked.parse(frMatch[1].trim()) as string,
      'en-CA': marked.parse(enMatch[1].trim()) as string,
    },
  }
}

function fetchConfirmedSubscribers(): SubscriberRow[] {
  const output = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'nuage-athletics',
      '--remote',
      '--json',
      '--command',
      "SELECT id, email, locale, token FROM subscribers WHERE status = 'confirmed'",
    ],
    { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 32 }
  )
  const parsed = JSON.parse(output) as { results: SubscriberRow[] }[]
  return parsed[0]?.results ?? []
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const { file, dryRun, limit } = parseArgs(process.argv.slice(2))
  const apiKey = process.env.RESEND_API_KEY

  if (!dryRun && !apiKey) {
    console.error(
      'RESEND_API_KEY is not set. Pass --dry-run to preview without sending, or set the key to send for real.'
    )
    process.exit(1)
  }

  const broadcast = parseBroadcastMarkdown(readFileSync(file, 'utf-8'))

  console.log('Fetching confirmed subscribers from the remote database...')
  let subscribers = fetchConfirmedSubscribers()
  if (limit) subscribers = subscribers.slice(0, limit)
  console.log(`${subscribers.length} confirmed subscriber(s) to send to.`)

  if (subscribers.length === 0) {
    console.log('Nothing to send.')
    return
  }

  const messages = subscribers.map((row) => {
    const locale: Locale = isLocale(row.locale) ? row.locale : 'fr-CA'
    const unsubUrl = `${SITE_URL}/api/unsubscribe?token=${row.token}`
    const html = renderEmailShell({
      locale,
      heading: broadcast.subject[locale],
      bodyHtml: broadcast.bodyHtml[locale],
      unsubUrl,
    })
    return { to: row.email, subject: broadcast.subject[locale], html, unsubUrl }
  })

  if (dryRun) {
    const sample = messages[0]
    console.log('\n--dry-run: not sending. Sample of the first message:\n')
    console.log(`To: ${sample.to}`)
    console.log(`Subject: ${sample.subject}`)
    console.log(`List-Unsubscribe: <${sample.unsubUrl}>`)
    console.log(
      `\n${messages.length} email(s) would be sent in ${chunk(messages, BATCH_SIZE).length} batch(es).`
    )
    return
  }

  const batches = chunk(messages, BATCH_SIZE)
  let sent = 0
  for (const [index, batch] of batches.entries()) {
    console.log(`Sending batch ${index + 1}/${batches.length} (${batch.length} email(s))...`)
    const res = await fetch(`${RESEND_ENDPOINT}/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        batch.map((m) => ({
          from: `${SENDER_IDENTITY.name} <${SENDER_IDENTITY.email}>`,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          headers: { 'List-Unsubscribe': `<${m.unsubUrl}>` },
        }))
      ),
    })

    if (!res.ok) {
      console.error(`Batch ${index + 1} failed: ${res.status} ${await res.text()}`)
      console.error(`Stopped after ${sent} successfully sent email(s).`)
      process.exit(1)
    }

    sent += batch.length
    if (index < batches.length - 1) await sleep(BATCH_DELAY_MS)
  }

  console.log(`Done. Sent ${sent} email(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
