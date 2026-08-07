import type { Locale } from '../i18n/config'

export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed'

export interface SubscriberRow {
  id: string
  email: string
  locale: Locale
  status: SubscriberStatus
  token: string
  consent_text: string
  consent_version: string
  consented_at: number
  confirmed_at: number | null
  unsubscribed_at: number | null
  ip: string | null
  user_agent: string | null
  source: string | null
  created_at: number
  token_expires_at: number | null
}

export interface NewSubscriber {
  email: string
  locale: Locale
  consentText: string
  consentVersion: string
  ip: string | null
  userAgent: string | null
  source: string | null
}

const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 5
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function isRateLimited(db: D1Database, ip: string): Promise<boolean> {
  const since = Date.now() - RATE_WINDOW_MS
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM signup_attempts WHERE ip = ? AND attempted_at > ?')
    .bind(ip, since)
    .first<{ n: number }>()
  return (row?.n ?? 0) >= RATE_MAX
}

/** Records this attempt and, in the same round trip, sweeps attempts that have
 * already aged out of the rate-limit window — otherwise the table grows forever. */
export async function recordAttempt(db: D1Database, ip: string): Promise<void> {
  const now = Date.now()
  await db.batch([
    db.prepare('INSERT INTO signup_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, now),
    db.prepare('DELETE FROM signup_attempts WHERE attempted_at <= ?').bind(now - RATE_WINDOW_MS),
  ])
}

export async function findByEmail(db: D1Database, email: string) {
  return db
    .prepare('SELECT * FROM subscribers WHERE email = ?')
    .bind(email)
    .first<SubscriberRow>()
}

export async function findByToken(db: D1Database, token: string) {
  return db
    .prepare('SELECT * FROM subscribers WHERE token = ?')
    .bind(token)
    .first<SubscriberRow>()
}

export async function insertSubscriber(
  db: D1Database,
  input: NewSubscriber
): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID()
  const token = crypto.randomUUID().replace(/-/g, '')
  const now = Date.now()

  await db
    .prepare(
      `INSERT INTO subscribers
        (id, email, locale, status, token, consent_text, consent_version,
         consented_at, ip, user_agent, source, created_at, token_expires_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.email,
      input.locale,
      token,
      input.consentText,
      input.consentVersion,
      now,
      input.ip,
      input.userAgent,
      input.source,
      now,
      now + TOKEN_TTL_MS
    )
    .run()

  return { id, token }
}

export interface OptInRestart {
  email: string
  locale: Locale
  consentText: string
  consentVersion: string
}

/**
 * Re-issue a confirmation token for an address that signed up again.
 *
 * Covers both the subscriber who never confirmed and the one who previously
 * unsubscribed. Signing up again is a fresh act of express consent, so the row
 * returns to 'pending' and records the wording shown *this* time.
 *
 * That is not the backfill CLAUDE.md forbids: the subscriber saw the current
 * wording when they re-consented, and this is the consent we would have to
 * prove if challenged. `unsubscribed_at` is deliberately left in place as
 * evidence the earlier withdrawal was honoured.
 *
 * Returns null when no row was updated — a confirmed subscriber, or a race
 * where one confirmed between the read and this write. Never return a token
 * that isn't in the database: the caller emails it, and a token that resolves
 * to nothing is a dead confirmation link.
 */
export async function restartOptIn(
  db: D1Database,
  input: OptInRestart
): Promise<string | null> {
  const token = crypto.randomUUID().replace(/-/g, '')
  const now = Date.now()
  const result = await db
    .prepare(
      `UPDATE subscribers
          SET token = ?, status = 'pending', locale = ?,
              consent_text = ?, consent_version = ?, consented_at = ?,
              token_expires_at = ?, confirmed_at = NULL
        WHERE email = ? AND status != 'confirmed'`
    )
    .bind(
      token,
      input.locale,
      input.consentText,
      input.consentVersion,
      now,
      now + TOKEN_TTL_MS,
      input.email
    )
    .run()

  return result.meta.changes > 0 ? token : null
}

export type ConfirmResult =
  | { ok: true; row: SubscriberRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'expired'; row: SubscriberRow }

export async function confirmSubscriber(db: D1Database, token: string): Promise<ConfirmResult> {
  const row = await findByToken(db, token)
  if (!row || row.status === 'unsubscribed') return { ok: false, reason: 'not_found' }
  if (row.status === 'confirmed') return { ok: true, row }
  // Pre-expiry rows (migrated before this column existed) have a NULL
  // token_expires_at and are treated as not-yet-expirable.
  if (row.token_expires_at !== null && Date.now() > row.token_expires_at) {
    return { ok: false, reason: 'expired', row }
  }
  const confirmedAt = Date.now()
  await db
    .prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE id = ?")
    .bind(confirmedAt, row.id)
    .run()
  return { ok: true, row: { ...row, status: 'confirmed', confirmed_at: confirmedAt } }
}

export async function unsubscribe(db: D1Database, token: string) {
  const row = await findByToken(db, token)
  if (!row) return null
  await db
    .prepare("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?")
    .bind(Date.now(), row.id)
    .run()
  return row
}
