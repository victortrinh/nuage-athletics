import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { unsubscribe } from '../../lib/db'
import { route } from '../../i18n/utils'
import { isLocale, DEFAULT_LOCALE } from '../../i18n/config'

export const prerender = false

/**
 * CASL: unsubscribe must be functional for at least 60 days after a send and
 * honoured within 10 business days. This is instant, which is simpler to defend.
 * GET so it works from a plain link in an email client.
 */
export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token')
  if (!token) return redirect('/', 302)

  const row = await unsubscribe(env.DB, token)
  const locale = row && isLocale(row.locale) ? row.locale : DEFAULT_LOCALE

  return redirect(route('unsubscribed', locale), 302)
}
