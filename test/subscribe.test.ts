import { describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { POST } from '../src/pages/api/subscribe'
import { confirmSubscriber, unsubscribe } from '../src/lib/db'

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

function makeFormContext(
  fields: Record<string, string | undefined>,
  opts: { ip?: string; origin?: string; omitOriginHeaders?: boolean } = {}
) {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) body.set(key, value)
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(opts.ip ? { 'CF-Connecting-IP': opts.ip } : {}),
  }
  if (!opts.omitOriginHeaders) {
    headers.Origin = opts.origin ?? 'https://nuageathletics.com'
  }
  const request = new Request('https://nuageathletics.com/api/subscribe', {
    method: 'POST',
    headers,
    body: body.toString(),
  })
  return {
    request,
    url: new URL(request.url),
    clientAddress: opts.ip ?? '203.0.113.1',
  } as Parameters<typeof POST>[0]
}

function validFormFields(overrides: Record<string, string | undefined> = {}) {
  return {
    email: uniqueEmail(),
    locale: 'fr-CA',
    consent: 'on',
    redirect: '/acces/',
    ...overrides,
  }
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

  it('reports failure when Resend rejects the send, and keeps the consent row', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('{"name":"validation_error","message":"domain is not verified"}', {
          status: 403,
        })
    )

    const body = validBody()
    const res = await POST(makeContext(body, { ip: '203.0.113.20' }))
    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ ok: false, code: 'email_failed' })

    // The row stays: consent was given, only delivery failed.
    const row = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
      .bind(body.email)
      .first<{ status: string; consent_version: string }>()
    expect(row?.status).toBe('pending')
    expect(row?.consent_version).toBeTruthy()
  })

  it('reports failure when the re-send to a pending subscriber is rejected', async () => {
    const body = validBody()
    const first = await POST(makeContext(body, { ip: '203.0.113.21' }))
    expect(first.status).toBe(200)

    vi.stubGlobal('fetch', async () => new Response('nope', { status: 403 }))

    const res = await POST(makeContext(body, { ip: '203.0.113.21' }))
    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ ok: false, code: 'email_failed' })
  })

  it('sends a working confirmation link when an unsubscribed address signs up again', async () => {
    const body = validBody()
    const sentHtml: string[] = []
    vi.stubGlobal('fetch', async (_input: unknown, init: RequestInit) => {
      sentHtml.push(JSON.parse(init.body as string).html)
      return new Response('{"id":"test"}', { status: 200 })
    })

    // Sign up, confirm, then unsubscribe.
    await POST(makeContext(body, { ip: '203.0.113.30' }))
    const first = await env.DB.prepare('SELECT token FROM subscribers WHERE email = ?')
      .bind(body.email)
      .first<{ token: string }>()
    await confirmSubscriber(env.DB, first!.token)
    await unsubscribe(env.DB, first!.token)

    // Sign up again — this is fresh express consent, so it must work.
    const res = await POST(makeContext(body, { ip: '203.0.113.30' }))
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
      .bind(body.email)
      .first<{ status: string; token: string }>()
    expect(row?.status).toBe('pending')

    // The token we actually emailed has to be the one in the database,
    // otherwise the subscriber clicks a dead link.
    const emailedToken = sentHtml.at(-1)!.match(/confirm\?token=([a-f0-9]+)/)![1]
    expect(emailedToken).toBe(row?.token)

    const result = await confirmSubscriber(env.DB, emailedToken)
    expect(result.ok).toBe(true)
  })

  it('records the consent wording shown at re-subscribe, not the original', async () => {
    const body = validBody()
    await POST(makeContext(body, { ip: '203.0.113.31' }))
    const before = await env.DB.prepare('SELECT token FROM subscribers WHERE email = ?')
      .bind(body.email)
      .first<{ token: string }>()
    await unsubscribe(env.DB, before!.token)

    // Simulate the row having been captured under older wording.
    await env.DB.prepare(
      "UPDATE subscribers SET consent_version = 'ancient.1', consent_text = 'old wording' WHERE email = ?"
    )
      .bind(body.email)
      .run()

    await POST(makeContext(body, { ip: '203.0.113.31' }))

    const row = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
      .bind(body.email)
      .first<{ consent_version: string; consent_text: string }>()
    expect(row?.consent_version).not.toBe('ancient.1')
    expect(row?.consent_text).not.toBe('old wording')
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

  it('still rejects a missing Turnstile token when a secret is configured', async () => {
    // vitest.config.ts binds no TURNSTILE_SECRET_KEY, so every other test in
    // this file exercises the "no secret configured, don't block" branch.
    // This is the one that proves the JSON path stays strictly enforced —
    // unlike the form-encoded path below, which is allowed to skip it.
    env.TURNSTILE_SECRET_KEY = 'test-secret'
    try {
      const body = validBody()
      const res = await POST(makeContext(body, { ip: '203.0.113.40' }))
      expect(res.status).toBe(400)
      expect(await readJson(res)).toEqual({ ok: false, code: 'challenge_failed' })
    } finally {
      delete env.TURNSTILE_SECRET_KEY
    }
  })
})

describe('POST /api/subscribe (form-encoded — the no-JS <form> fallback)', () => {
  it('accepts a valid signup and redirects back to the referring page with sent=1', async () => {
    const fields = validFormFields()
    const res = await POST(makeFormContext(fields, { ip: '203.0.113.60' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/acces/?sent=1')

    const row = await env.DB.prepare('SELECT status FROM subscribers WHERE email = ?')
      .bind(fields.email)
      .first<{ status: string }>()
    expect(row?.status).toBe('pending')
  })

  it('honours the locale hidden field and the English gate path', async () => {
    const fields = validFormFields({ locale: 'en-CA', redirect: '/en/access/' })
    const res = await POST(makeFormContext(fields, { ip: '203.0.113.61' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/en/access/?sent=1')

    const row = await env.DB.prepare('SELECT locale FROM subscribers WHERE email = ?')
      .bind(fields.email)
      .first<{ locale: string }>()
    expect(row?.locale).toBe('en-CA')
  })

  it('bounces back with se=consent_required when the box was left unchecked, and writes no row', async () => {
    const fields = validFormFields({ consent: undefined })
    const res = await POST(makeFormContext(fields, { ip: '203.0.113.62' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/acces/?se=consent_required')

    const row = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
      .bind(fields.email)
      .first()
    expect(row).toBeNull()
  })

  it('overwrites a stale outcome param on the redirect target instead of accumulating it', async () => {
    const fields = validFormFields({ redirect: '/acces/?se=rate_limited' })
    const res = await POST(makeFormContext(fields, { ip: '203.0.113.63' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/acces/?sent=1')
  })

  it('accepts a missing Turnstile token even with a secret configured', async () => {
    env.TURNSTILE_SECRET_KEY = 'test-secret'
    try {
      const fields = validFormFields()
      const res = await POST(makeFormContext(fields, { ip: '203.0.113.64' }))
      expect(res.status).toBe(303)
      expect(res.headers.get('Location')).toBe('/acces/?sent=1')
    } finally {
      delete env.TURNSTILE_SECRET_KEY
    }
  })

  it('rejects a cross-origin form POST and writes no row', async () => {
    const fields = validFormFields()
    const res = await POST(
      makeFormContext(fields, { ip: '203.0.113.65', origin: 'https://evil.example' })
    )
    expect(res.status).toBe(400)

    const row = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
      .bind(fields.email)
      .first()
    expect(row).toBeNull()
  })

  it('rejects a form POST carrying neither Origin nor Sec-Fetch-Site', async () => {
    const fields = validFormFields()
    const res = await POST(makeFormContext(fields, { ip: '203.0.113.66', omitOriginHeaders: true }))
    expect(res.status).toBe(400)
  })

  it('falls back to / when the redirect field is missing', async () => {
    const fields = validFormFields({ redirect: undefined })
    const res = await POST(makeFormContext(fields, { ip: '203.0.113.67' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/?sent=1')
  })
})
