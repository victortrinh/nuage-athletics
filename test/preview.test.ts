import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { commerceEnabled } from '../src/lib/commerce/index'
import {
  PREVIEW_COOKIE,
  applyPreview,
  clearCookieHeader,
  cookieHeader,
  issueToken,
  passwordMatches,
  previewActive,
  readCookie,
  safeRedirect,
  tokenIsValid,
} from '../src/lib/preview'

const PASSWORD = 'test-preview-password'

/**
 * applyPreview is called the way src/middleware.ts calls it, rather than
 * through a server: a context and a `next` that stands in for the rendered
 * page. Same discipline as test/webhooks-stripe.test.ts calling the route's
 * POST directly.
 */
let seq = 0
async function visit(
  path: string,
  { cookie, ip }: { cookie?: string; ip?: string } = {}
): Promise<Response> {
  seq += 1
  const address = ip ?? `198.51.100.${seq % 200}`
  const request = new Request(`https://nuageathletics.com${path}`, {
    headers: {
      'CF-Connecting-IP': address,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  })
  const context = { request, url: new URL(request.url), clientAddress: address }

  return applyPreview(env, context, async () => new Response('page', { status: 200 }))
}

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie')
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';')[0]
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
    // The signature is hex, so flipping the last character to a fixed digit
    // is a no-op ~1/16 of the time; pick a digit guaranteed to differ.
    const tamperedDigit = token.endsWith('0') ? '1' : '0'
    expect(await tokenIsValid(PASSWORD, `${token.slice(0, -1)}${tamperedDigit}`)).toBe(false)
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
    expect(passwordMatches('test-preview-passwore', PASSWORD)).toBe(false)
    expect(passwordMatches('test-preview-passwor', PASSWORD)).toBe(false)
    expect(passwordMatches('', PASSWORD)).toBe(false)
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

  it('clears with a matching, immediately-expiring cookie', () => {
    const header = clearCookieHeader(true)
    expect(header).toContain(`${PREVIEW_COOKIE}=`)
    expect(header).toContain('Max-Age=0')
    expect(header).toContain('Path=/')
  })

  it('reads one cookie out of a crowded header', () => {
    expect(readCookie(`a=1; ${PREVIEW_COOKIE}=tok; b=2`, PREVIEW_COOKIE)).toBe('tok')
    expect(readCookie('a=1; b=2', PREVIEW_COOKIE)).toBeUndefined()
    expect(readCookie(null, PREVIEW_COOKIE)).toBeUndefined()
  })
})

describe('previewActive', () => {
  it('is off with no cookie, and on with a valid one', async () => {
    expect(await previewActive({ PREVIEW_PASSWORD: PASSWORD }, null)).toBe(false)
    const token = await issueToken(PASSWORD)
    expect(
      await previewActive({ PREVIEW_PASSWORD: PASSWORD }, `${PREVIEW_COOKIE}=${token}`)
    ).toBe(true)
  })

  it('is off when no preview password is configured, valid cookie or not', async () => {
    // Preview is an operator tool. An unconfigured one means nobody is
    // previewing, not that the site is broken.
    const token = await issueToken(PASSWORD)
    expect(await previewActive({}, `${PREVIEW_COOKIE}=${token}`)).toBe(false)
  })
})

describe('the site is public', () => {
  it('serves the home page with no cookie and no redirect', async () => {
    const res = await visit('/')
    expect(res.status).toBe(200)
  })

  it('leaves an ordinary response cacheable', async () => {
    // Only a preview render is marked private — see the note in middleware.ts.
    const res = await visit('/')
    expect(res.headers.get('Cache-Control')).toBeNull()
  })
})

describe('unlocking preview', () => {
  it('issues a working cookie for the correct password', async () => {
    const res = await visit(`/?preview=${PASSWORD}`)
    expect(res.status).toBe(303)

    const token = readCookie(cookieFrom(res), PREVIEW_COOKIE)
    expect(await tokenIsValid(env.PREVIEW_PASSWORD!, token)).toBe(true)
  })

  it('strips the secret from the URL it sends you back to', async () => {
    // Otherwise it lives on in history, in bookmarks, and in the Referer of
    // everything the page goes on to load.
    const res = await visit(`/en/?preview=${PASSWORD}`)
    expect(res.headers.get('Location')).toBe('/en/')
  })

  it('keeps any other query parameters', async () => {
    const res = await visit(`/?sent=1&preview=${PASSWORD}`)
    expect(res.headers.get('Location')).toBe('/?sent=1')
  })

  it('never puts the password in the cookie', async () => {
    const res = await visit(`/?preview=${PASSWORD}`)
    expect(res.headers.get('Set-Cookie')).not.toContain(PASSWORD)
  })

  it('answers a wrong password with 404 and no cookie', async () => {
    // 404, not 401: a wrong guess should not confirm that preview exists.
    const res = await visit('/?preview=wrong')
    expect(res.status).toBe(404)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('rate limits repeated wrong guesses from one address', async () => {
    const ip = '198.51.100.250'
    let sawRateLimit = false
    for (let i = 0; i < 12; i++) {
      const res = await visit('/?preview=wrong', { ip })
      if (res.status === 429) {
        sawRateLimit = true
        break
      }
    }
    expect(sawRateLimit).toBe(true)
  })

  it('stops handing out cookies once rate limited', async () => {
    const ip = '198.51.100.251'
    for (let i = 0; i < 12; i++) {
      await visit('/?preview=wrong', { ip })
    }
    // The correct password must not slip through the limiter either —
    // otherwise the limit is trivially bypassed by guessing in parallel.
    const res = await visit(`/?preview=${PASSWORD}`, { ip })
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })
})

describe('leaving preview', () => {
  it('clears the cookie for an empty preview parameter, with no password', async () => {
    const res = await visit('/?preview=')
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/')
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })
})

describe('a preview render is never shared', () => {
  it('marks the response private and uncacheable', async () => {
    // A per-visitor price behind a shared cache is exactly the failure
    // CLAUDE.md non-negotiable 5.5 exists to prevent.
    const token = await issueToken(PASSWORD)
    const res = await visit('/', { cookie: `${PREVIEW_COOKIE}=${token}` })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('leaves a forged cookie cacheable, because it is not a preview at all', async () => {
    const res = await visit('/', { cookie: `${PREVIEW_COOKIE}=123.deadbeef` })
    expect(res.headers.get('Cache-Control')).toBeNull()
  })
})

describe('commerceEnabled', () => {
  it('is off for the public while COMMERCE_ENABLED is not "true"', async () => {
    expect(await commerceEnabled({}, null)).toBe(false)
    expect(await commerceEnabled({ COMMERCE_ENABLED: 'false' }, null)).toBe(false)
  })

  it('is on for a visitor carrying a valid preview cookie', async () => {
    const token = await issueToken(PASSWORD)
    expect(
      await commerceEnabled(
        { PREVIEW_PASSWORD: PASSWORD },
        `${PREVIEW_COOKIE}=${token}`
      )
    ).toBe(true)
  })

  it('is on for everyone once COMMERCE_ENABLED is "true"', async () => {
    expect(await commerceEnabled({ COMMERCE_ENABLED: 'true' }, null)).toBe(true)
  })

  it('is off for a preview cookie signed with the wrong password', async () => {
    const token = await issueToken('some-other-password')
    expect(
      await commerceEnabled(
        { PREVIEW_PASSWORD: PASSWORD },
        `${PREVIEW_COOKIE}=${token}`
      )
    ).toBe(false)
  })
})
