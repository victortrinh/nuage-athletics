import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { confirmSubscriber } from '../../lib/db'
import { route } from '../../i18n/utils'
import { isLocale, DEFAULT_LOCALE } from '../../i18n/config'

export const prerender = false

export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token')
  if (!token) return redirect('/', 302)

  const row = await confirmSubscriber(env.DB, token)
  const locale = row && isLocale(row.locale) ? row.locale : DEFAULT_LOCALE

  return redirect(route('confirmed', locale), 302)
}
