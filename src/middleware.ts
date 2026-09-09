import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { applyPreview } from './lib/preview'

/**
 * Founder preview.
 *
 * What used to live here was the pre-launch password gate, which rewrote every
 * request to a password screen. The site is public now, so the wall is gone —
 * what remains is the narrower job of recognising one of us and rendering the
 * buy flow that the public should not see yet (src/lib/commerce/index.ts reads
 * the cookie this sets).
 *
 * The logic itself lives in src/lib/preview.ts. `astro:middleware` only
 * resolves inside a built Astro app, so anything in this file is unreachable
 * from the test suite — keeping it to one line means the behaviour is not.
 *
 * This only works because every page under src/pages sets `prerender = false`.
 * Workers Static Assets answers a request that matches a prerendered file
 * without ever invoking the Worker, so middleware would never see it. If a page
 * is ever switched back to prerendering, it silently stops being previewable —
 * and, worse, would cache one render for everyone.
 */
export const onRequest = defineMiddleware((context, next) =>
  applyPreview(env, context, () => next() as Promise<Response>)
)
