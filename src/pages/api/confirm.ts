import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { confirmSubscriber } from '../../lib/db'
import { route } from '../../i18n/utils'
import { isLocale, DEFAULT_LOCALE } from '../../i18n/config'

export const prerender = false

export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token')
  if (!token) return redirect('/', 302)

  const result = await confirmSubscriber(env.DB, token)

  if (!result.ok && result.reason === 'expired') {
    // Send them back to the signup form instead of a "confirmed" page that
    // would be a lie — resubmitting there re-sends a fresh token.
    const locale = isLocale(result.row.locale) ? result.row.locale : DEFAULT_LOCALE
    return redirect(route('home', locale), 302)
  }

  const locale = result.ok && isLocale(result.row.locale) ? result.row.locale : DEFAULT_LOCALE
  return redirect(route('confirmed', locale), 302)
}
