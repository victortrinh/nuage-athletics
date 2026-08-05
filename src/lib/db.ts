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

export async function isRateLimited(db: D1Database, ip: string): Promise<boolean> {
  const since = Date.now() - RATE_WINDOW_MS
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM signup_attempts WHERE ip = ? AND attempted_at > ?')
    .bind(ip, since)
    .first<{ n: number }>()
  return (row?.n ?? 0) >= RATE_MAX
}

export async function recordAttempt(db: D1Database, ip: string): Promise<void> {
  await db
    .prepare('INSERT INTO signup_attempts (ip, attempted_at) VALUES (?, ?)')
    .bind(ip, Date.now())
    .run()
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
         consented_at, ip, user_agent, source, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
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
      now
    )
    .run()

  return { id, token }
}

/** Re-issue a token for someone who signed up but never confirmed. */
export async function refreshPendingToken(db: D1Database, email: string): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '')
  await db
    .prepare("UPDATE subscribers SET token = ?, consented_at = ? WHERE email = ? AND status = 'pending'")
    .bind(token, Date.now(), email)
    .run()
  return token
}

export async function confirmSubscriber(db: D1Database, token: string) {
  const row = await findByToken(db, token)
  if (!row || row.status === 'unsubscribed') return null
  if (row.status === 'confirmed') return row
  await db
    .prepare("UPDATE subscribers SET status = 'confirmed', confirmed_at = ? WHERE id = ?")
    .bind(Date.now(), row.id)
    .run()
  return row
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
