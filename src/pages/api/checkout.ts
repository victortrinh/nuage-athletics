import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { isLocale, DEFAULT_LOCALE } from '../../i18n/config.ts'
import { getCommerce, commerceEnabled } from '../../lib/commerce/index.ts'
import { route } from '../../i18n/utils.ts'

export const prerender = false

const Body = z.object({
  variantId: z.string(),
  quantity: z.number().int().min(1).max(10).default(1),
  locale: z.string().refine(isLocale).catch(DEFAULT_LOCALE),
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ request, url }) => {
  if (!commerceEnabled(env)) return json({ ok: false, code: 'not_found' }, 404)

  let parsed
  try {
    parsed = Body.safeParse(await request.json())
  } catch {
    return json({ ok: false, code: 'bad_request' }, 400)
  }
  if (!parsed.success) return json({ ok: false, code: 'bad_request' }, 400)

  const { variantId, quantity, locale } = parsed.data
  const siteUrl = env.PUBLIC_SITE_URL ?? url.origin

  try {
    const commerce = getCommerce(env)
    const session = await commerce.createCheckout({
      lines: [{ variantId, quantity }],
      locale,
      successUrl: `${siteUrl}${route('orderConfirmed', locale)}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl}${route('orderCancelled', locale)}`,
    })
    return json({ ok: true, url: session.url })
  } catch (err) {
    console.error('checkout failed', err)
    return json({ ok: false, code: 'checkout_failed' }, 500)
  }
}
