import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { POST } from '../src/pages/api/subscribe'

let seq = 0
function uniqueEmail() {
  seq += 1
  return `subscriber-${Date.now()}-${seq}@example.com`
}

function makeContext(body: unknown, opts: { ip?: string } = {}) {
  const request = new Request('https://nuageathletics.com/api/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.ip ? { 'CF-Connecting-IP': opts.ip } : {}),
    },
    body: JSON.stringify(body),
  })
  return {
    request,
    url: new URL(request.url),
    clientAddress: opts.ip ?? '203.0.113.1',
  } as Parameters<typeof POST>[0]
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    email: uniqueEmail(),
    locale: 'fr-CA',
    consent: true,
    ...overrides,
  }
}

async function readJson(res: Response) {
  return (await res.json()) as { ok: boolean; code?: string }
}

describe('POST /api/subscribe', () => {
  it('accepts a valid signup and stores a pending subscriber', async () => {
    const body = validBody()
    const res = await POST(makeContext(body, { ip: '203.0.113.10' }))
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: true })

    const row = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
      .bind(body.email)
      .first<{ status: string; token: string; token_expires_at: number }>()
    expect(row?.status).toBe('pending')
    expect(row?.token).toBeTruthy()
    expect(row?.token_expires_at).toBeGreaterThan(Date.now())
  })

  it('rejects consent: false', async () => {
    const body = validBody({ consent: false })
    const res = await POST(makeContext(body, { ip: '203.0.113.11' }))
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ ok: false, code: 'consent_required' })

    const row = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
      .bind(body.email)
      .first()
    expect(row).toBeNull()
  })

  it('rejects a malformed email', async () => {
    const body = validBody({ email: 'not-an-email' })
    const res = await POST(makeContext(body, { ip: '203.0.113.12' }))
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ ok: false, code: 'invalid_email' })
  })

  it('honeypot: returns ok without inserting a row', async () => {
    const body = validBody({ company: 'Definitely A Real Company' })
    const res = await POST(makeContext(body, { ip: '203.0.113.13' }))
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: true })

    const row = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
      .bind(body.email)
      .first()
    expect(row).toBeNull()
  })

  it('returns already_subscribed for a confirmed email', async () => {
    const body = validBody()
    await POST(makeContext(body, { ip: '203.0.113.14' }))
    await env.DB.prepare("UPDATE subscribers SET status = 'confirmed' WHERE email = ?")
      .bind(body.email)
      .run()

    const res = await POST(makeContext(body, { ip: '203.0.113.14' }))
    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ ok: false, code: 'already_subscribed' })
  })

  it('rate limits after 5 attempts from the same IP', async () => {
    const ip = '203.0.113.15'
    const results: Response[] = []
    for (let i = 0; i < 6; i += 1) {
      results.push(await POST(makeContext(validBody(), { ip })))
    }
    const statuses = results.map((r) => r.status)
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(statuses[5]).toBe(429)
    expect(await readJson(results[5])).toEqual({ ok: false, code: 'rate_limited' })
  })
})
