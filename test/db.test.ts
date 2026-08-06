import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { confirmSubscriber, insertSubscriber, recordAttempt } from '../src/lib/db'

let seq = 0
function uniqueEmail() {
  seq += 1
  return `db-test-${Date.now()}-${seq}@example.com`
}

describe('confirmSubscriber', () => {
  it('rejects an expired token and leaves the row pending', async () => {
    const { token } = await insertSubscriber(env.DB, {
      email: uniqueEmail(),
      locale: 'fr-CA',
      consentText: 'consent',
      consentVersion: 'v1',
      ip: null,
      userAgent: null,
      source: null,
    })
    // Backdate the expiry as if the token was issued 8 days ago.
    await env.DB.prepare('UPDATE subscribers SET token_expires_at = ? WHERE token = ?')
      .bind(Date.now() - 1000, token)
      .run()

    const result = await confirmSubscriber(env.DB, token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')

    const row = await env.DB.prepare('SELECT status FROM subscribers WHERE token = ?')
      .bind(token)
      .first<{ status: string }>()
    expect(row?.status).toBe('pending')
  })

  it('confirms a token that has not expired yet', async () => {
    const { token } = await insertSubscriber(env.DB, {
      email: uniqueEmail(),
      locale: 'fr-CA',
      consentText: 'consent',
      consentVersion: 'v1',
      ip: null,
      userAgent: null,
      source: null,
    })

    const result = await confirmSubscriber(env.DB, token)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.row.status).toBe('confirmed')
  })
})

describe('recordAttempt', () => {
  it('sweeps attempts older than the rate-limit window', async () => {
    const ip = '198.51.100.1'
    const staleWindowMs = 10 * 60 * 1000
    await env.DB.prepare('INSERT INTO signup_attempts (ip, attempted_at) VALUES (?, ?)')
      .bind(ip, Date.now() - staleWindowMs - 1000)
      .run()

    await recordAttempt(env.DB, ip)

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM signup_attempts WHERE ip = ?')
      .bind(ip)
      .first<{ n: number }>()
    // The stale row is swept; only the fresh one from this call remains.
    expect(row?.n).toBe(1)
  })
})
