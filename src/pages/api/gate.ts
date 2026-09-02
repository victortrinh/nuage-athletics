import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { isRateLimited, recordAttempt } from '../../lib/db'
import { cookieHeader, issueToken, passwordMatches, safeRedirect, siteLocked } from '../../lib/gate'

export const prerender = false

function back(to: string, error: 'bad' | 'rate'): Response {
  const gate = to.startsWith('/en/') ? '/en/access' : '/acces'
  return new Response(null, {
    status: 303,
    headers: { Location: `${gate}?to=${encodeURIComponent(to)}&e=${error}` },
  })
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!siteLocked(env)) return new Response('Not found', { status: 404 })

  const form = await request.formData().catch(() => null)
  if (!form) return new Response('Bad request', { status: 400 })

  const to = safeRedirect(String(form.get('to') ?? '/'))
  const supplied = String(form.get('password') ?? '')
  const ip = request.headers.get('CF-Connecting-IP') ?? clientAddress ?? 'unknown'

  if (await isRateLimited(env.DB, ip, 'gate')) return back(to, 'rate')

  if (!passwordMatches(supplied, env.SITE_PASSWORD!)) {
    await recordAttempt(env.DB, ip, 'gate')
    return back(to, 'bad')
  }

  const token = await issueToken(env.SITE_PASSWORD!)
  return new Response(null, {
    status: 303,
    headers: {
      Location: to,
      'Set-Cookie': cookieHeader(token, new URL(request.url).protocol === 'https:'),
    },
  })
}
