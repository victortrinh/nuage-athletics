/**
 * Read the subscriber list. There is no admin UI by decision — an SSR
 * /admin route would put every subscriber email behind one shared secret and
 * widen founder preview, which CLAUDE.md says to resist — so this is the way
 * in: a count summary plus recent rows, with an optional CSV export.
 *
 * Usage:
 *   npm run db:subscribers                          -- summary + last 20, remote
 *   npm run db:subscribers -- --local                -- against local D1
 *   npm run db:subscribers -- --status confirmed
 *   npm run db:subscribers -- --limit 200
 *   npm run db:subscribers -- --all                  -- no row cap
 *   npm run db:subscribers -- --csv /path/outside/repo/subs.csv
 *
 * Reuses the same `wrangler d1 execute` path as scripts/broadcast.ts
 * (scripts/d1.ts) rather than a second ad hoc SQL string.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { queryD1 } from './d1.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_LIMIT = 20

interface SubscriberRow {
  email: string
  locale: string
  status: string
  consented_at: number
  confirmed_at: number | null
}

interface StatusCount {
  status: string
  n: number
}

function parseArgs(argv: string[]) {
  const remote = !argv.includes('--local')
  const all = argv.includes('--all')
  const statusIndex = argv.indexOf('--status')
  const status = statusIndex !== -1 ? argv[statusIndex + 1] : undefined
  const limitIndex = argv.indexOf('--limit')
  const limit = limitIndex !== -1 ? Number(argv[limitIndex + 1]) : DEFAULT_LIMIT
  const csvIndex = argv.indexOf('--csv')
  const csvPath = csvIndex !== -1 ? argv[csvIndex + 1] : undefined
  return { remote, all, status, limit, csvPath }
}

function isoOrNull(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString()
}

function main() {
  const { remote, all, status, limit, csvPath } = parseArgs(process.argv.slice(2))

  if (csvPath) {
    // A CSV of subscriber emails is PII with no business being tracked by
    // git — refuse a path anywhere inside the repo rather than trust the
    // caller to remember .gitignore.
    const absolute = resolve(csvPath)
    if (absolute.startsWith(REPO_ROOT)) {
      console.error(
        `Refusing to write inside the repository (${REPO_ROOT}). Pass a path outside it.`
      )
      process.exit(1)
    }
  }

  const counts = queryD1<StatusCount>('SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status', {
    remote,
  })
  console.log(`Subscribers (${remote ? 'remote' : 'local'}):`)
  for (const row of counts) console.log(`  ${row.status}: ${row.n}`)
  const total = counts.reduce((sum, row) => sum + row.n, 0)
  console.log(`  total: ${total}`)

  const where = status ? `WHERE status = '${status.replace(/'/g, '')}'` : ''
  const orderLimit = all ? '' : `LIMIT ${Math.max(1, limit)}`
  const rows = queryD1<SubscriberRow>(
    `SELECT email, locale, status, consented_at, confirmed_at FROM subscribers ${where} ORDER BY created_at DESC ${orderLimit}`,
    { remote }
  )

  if (csvPath) {
    const header = 'email,locale,status,consented_at,confirmed_at'
    const lines = rows.map(
      (r) => `${r.email},${r.locale},${r.status},${isoOrNull(r.consented_at)},${isoOrNull(r.confirmed_at)}`
    )
    writeFileSync(csvPath, [header, ...lines].join('\n') + '\n')
    console.log(`\nWrote ${rows.length} row(s) to ${csvPath}.`)
    console.log('This file contains subscriber PII — do not commit it or move it into the repo.')
    return
  }

  console.log(`\n${all ? 'All' : `Last ${limit}`}${status ? ` (${status})` : ''}:\n`)
  for (const row of rows) {
    console.log(`  ${row.email}\t${row.locale}\t${row.status}\t${isoOrNull(row.consented_at)}`)
  }
}

main()
