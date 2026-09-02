import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { POST } from '../src/pages/api/gate'
import {
  GATE_COOKIE,
  cookieHeader,
  isGatePath,
  isOpenPath,
  issueToken,
  passwordMatches,
  readCookie,
  safeRedirect,
  siteLocked,
  tokenIsValid,
} from '../src/lib/gate'

const PASSWORD = 'test-gate-password'

let seq = 0
function makeContext(fields: Record<string, string>, ip?: string) {
  seq += 1
  const body = new URLSearchParams(fields)
  const request = new Request('https://nuageathletics.com/api/gate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'CF-Connecting-IP': ip ?? `198.51.100.${seq % 200}`,
    },
    body,
  })
  return {
    request,
    url: new URL(request.url),
    clientAddress: ip ?? `198.51.100.${seq % 200}`,
  } as Parameters<typeof POST>[0]
}

describe('token', () => {
  it('accepts a token it just issued', async () => {
    expect(await tokenIsValid(PASSWORD, await issueToken(PASSWORD))).toBe(true)
  })

  it('rejects a token signed with a different password', async () => {
    // Changing the password must invalidate every session already handed out.
    expect(await tokenIsValid('other-password', await issueToken(PASSWORD))).toBe(false)
  })

  it('rejects a tampered signature', async () => {
    const token = await issueToken(PASSWORD)
    expect(await tokenIsValid(PASSWORD, `${token.slice(0, -1)}0`)).toBe(false)
  })

  it('rejects an expiry moved into the future without a matching signature', async () => {
    const token = await issueToken(PASSWORD)
    const forged = `${Date.now() + 10_000_000}.${token.split('.')[1]}`
    expect(await tokenIsValid(PASSWORD, forged)).toBe(false)
  })

  it('rejects an expired token even though it was signed correctly', async () => {
    const past = Date.now() - 1000 * 60 * 60 * 24 * 365
    const token = await issueToken(PASSWORD, past)
    expect(await tokenIsValid(PASSWORD, token)).toBe(false)
  })

  it('rejects a missing or shapeless token', async () => {
    expect(await tokenIsValid(PASSWORD, undefined)).toBe(false)
    expect(await tokenIsValid(PASSWORD, '')).toBe(false)
    expect(await tokenIsValid(PASSWORD, 'nodot')).toBe(false)
    expect(await tokenIsValid(PASSWORD, '.onlysig')).toBe(false)
  })
})

describe('password comparison', () => {
  it('matches only the exact password', () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true)
    expect(passwordMatches('test-gate-passwore', PASSWORD)).toBe(false)
    expect(passwordMatches('test-gate-passwor', PASSWORD)).toBe(false)
    expect(passwordMatches('', PASSWORD)).toBe(false)
  })
})

describe('siteLocked', () => {
  it('is off unless explicitly turned on', () => {
    expect(siteLocked({ SITE_PASSWORD: 'x' })).toBe(false)
    expect(siteLocked({ SITE_LOCKED: 'false', SITE_PASSWORD: 'x' })).toBe(false)
    expect(siteLocked({ SITE_LOCKED: 'true', SITE_PASSWORD: 'x' })).toBe(true)
  })

  it('fails open when no password is configured', () => {
    // A lock with no key would make the site unopenable by anyone, including
    // its owner. Better to serve the site than to brick it.
    expect(siteLocked({ SITE_LOCKED: 'true' })).toBe(false)
    expect(siteLocked({ SITE_LOCKED: 'true', SITE_PASSWORD: '' })).toBe(false)
  })
})

describe('exempt paths', () => {
  it('leaves the email lifecycle reachable while locked', () => {
    // These links are already sitting in inboxes; CASL obliges unsubscribe to
    // keep working, and a password wall is not an exception the law grants.
    expect(isOpenPath('/api/confirm')).toBe(true)
    expect(isOpenPath('/api/unsubscribe')).toBe(true)
    expect(isOpenPath('/api/subscribe')).toBe(true)
    expect(isOpenPath('/api/webhooks/stripe')).toBe(true)
  })

  it('leaves the privacy policy and terms reachable while locked', () => {
    // The gate screen collects an email; the policy explaining that
    // collection cannot sit behind the same wall.
    expect(isOpenPath('/confidentialite')).toBe(true)
    expect(isOpenPath('/conditions')).toBe(true)
    expect(isOpenPath('/en/privacy')).toBe(true)
    expect(isOpenPath('/en/terms')).toBe(true)
  })

  it('does not exempt the pages the gate exists to hide', () => {
    expect(isOpenPath('/')).toBe(false)
    expect(isOpenPath('/en/')).toBe(false)
    expect(isOpenPath('/produit/chandail-manches-longues-01')).toBe(false)
    expect(isOpenPath('/api/checkout')).toBe(false)
  })

  it('recognises both locale gate screens', () => {
    expect(isGatePath('/acces')).toBe(true)
    expect(isGatePath('/acces/')).toBe(true)
    expect(isGatePath('/en/access')).toBe(true)
    expect(isGatePath('/')).toBe(false)
  })
})

describe('safeRedirect', () => {
  it('keeps same-origin paths', () => {
    expect(safeRedirect('/produit/x')).toBe('/produit/x')
    expect(safeRedirect('/en/')).toBe('/en/')
  })

  it('refuses to bounce anywhere off-site', () => {
    expect(safeRedirect('//evil.example/x')).toBe('/')
    expect(safeRedirect('https://evil.example')).toBe('/')
    expect(safeRedirect('http://evil.example')).toBe('/')
    expect(safeRedirect(null)).toBe('/')
    expect(safeRedirect('')).toBe('/')
  })

  it('refuses to bounce back to the gate itself', () => {
    expect(safeRedirect('/acces')).toBe('/')
    expect(safeRedirect('/en/access?to=%2F')).toBe('/')
  })
})

describe('cookie', () => {
  it('is HttpOnly, scoped to the site, and SameSite', () => {
    const header = cookieHeader('abc', true)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
    expect(header).toContain('Secure')
  })

  it('drops Secure over plain http so local dev can set it', () => {
    expect(cookieHeader('abc', false)).not.toContain('Secure')
  })

  it('reads one cookie out of a crowded header', () => {
    expect(readCookie(`a=1; ${GATE_COOKIE}=tok; b=2`, GATE_COOKIE)).toBe('tok')
    expect(readCookie('a=1; b=2', GATE_COOKIE)).toBeUndefined()
    expect(readCookie(null, GATE_COOKIE)).toBeUndefined()
  })
})

describe('POST /api/gate', () => {
  it('issues a working cookie for the correct password', async () => {
    const res = await POST(makeContext({ password: PASSWORD, to: '/' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/')

    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toBeTruthy()
    const token = readCookie(setCookie!.split(';')[0], GATE_COOKIE)
    expect(await tokenIsValid(env.SITE_PASSWORD!, token)).toBe(true)
  })

  it('never puts the password in the cookie', async () => {
    const res = await POST(makeContext({ password: PASSWORD, to: '/' }))
    expect(res.headers.get('Set-Cookie')).not.toContain(PASSWORD)
  })

  it('sends a wrong password back to the gate with no cookie', async () => {
    const res = await POST(makeContext({ password: 'wrong', to: '/' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect(res.headers.get('Location')).toContain('/acces')
    expect(res.headers.get('Location')).toContain('e=bad')
  })

  it('returns an English failure to the English gate', async () => {
    const res = await POST(makeContext({ password: 'wrong', to: '/en/' }))
    expect(res.headers.get('Location')).toContain('/en/access')
  })

  it('refuses to redirect off-site even with the right password', async () => {
    const res = await POST(makeContext({ password: PASSWORD, to: '//evil.example' }))
    expect(res.headers.get('Location')).toBe('/')
  })

  it('rate limits repeated wrong guesses from one address', async () => {
    const ip = '198.51.100.250'
    let sawRateLimit = false
    for (let i = 0; i < 12; i++) {
      const res = await POST(makeContext({ password: 'wrong', to: '/' }, ip))
      if (res.headers.get('Location')?.includes('e=rate')) {
        sawRateLimit = true
        break
      }
    }
    expect(sawRateLimit).toBe(true)
  })

  it('stops handing out cookies once rate limited', async () => {
    const ip = '198.51.100.251'
    for (let i = 0; i < 12; i++) {
      await POST(makeContext({ password: 'wrong', to: '/' }, ip))
    }
    // The correct password must not slip through the limiter either —
    // otherwise the limit is trivially bypassed by guessing in parallel.
    const res = await POST(makeContext({ password: PASSWORD, to: '/' }, ip))
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })
})
