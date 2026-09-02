import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { localeFromPath } from './i18n/config'
import {
  GATE_COOKIE,
  isGatePath,
  isOpenPath,
  readCookie,
  siteLocked,
  tokenIsValid,
} from './lib/gate'

/**
 * The pre-launch password gate.
 *
 * This only works because every page under src/pages sets `prerender = false`.
 * Workers Static Assets answers a request that matches a prerendered file
 * without ever invoking the Worker, so middleware would never see it — a gate
 * in front of a prerendered page is not a gate. If a page is ever switched
 * back to prerendering, it silently leaves the wall.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url

  if (!siteLocked(env)) {
    // With the site open, the gate screens are dead ends that would otherwise
    // be crawlable and indexable.
    if (isGatePath(pathname)) return new Response('Not found', { status: 404 })
    return next()
  }

  if (isOpenPath(pathname) || isGatePath(pathname)) return next()

  const token = readCookie(context.request.headers.get('Cookie'), GATE_COOKIE)
  if (await tokenIsValid(env.SITE_PASSWORD!, token)) return next()

  const gate = localeFromPath(pathname) === 'en-CA' ? '/en/access' : '/acces'
  // Rewrite rather than redirect: the visitor keeps the URL they asked for, so
  // unlocking can return them to it, and no page HTML is produced for them.
  return context.rewrite(`${gate}?to=${encodeURIComponent(context.url.pathname + context.url.search)}`)
})
