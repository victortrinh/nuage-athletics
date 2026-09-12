import { defineMiddleware } from 'astro:middleware'
import { env } from 'cloudflare:workers'
import { applyCheckoutReturn } from './lib/cart'
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
 * The second layer is `applyCheckoutReturn` (src/lib/cart.ts): checkout
 * happens on Shopify's hosted page, so a completed purchase empties a cart
 * without any response from this site, and the header's cart count — a
 * cookie, deliberately never a Storefront call per page view — is left
 * saying the old number (#88). It reconciles that once, on the first
 * document request after the hand-off. Same shape as `applyPreview` and for
 * the same reason: the logic is in a file the test suite can import.
 *
 * This only works because every page under src/pages sets `prerender = false`.
 * Workers Static Assets answers a request that matches a prerendered file
 * without ever invoking the Worker, so middleware would never see it. If a page
 * is ever switched back to prerendering, it silently stops being previewable —
 * and, worse, would cache one render for everyone.
 */
export const onRequest = defineMiddleware((context, next) =>
  applyPreview(env, context, () =>
    applyCheckoutReturn(env, context, () => next() as Promise<Response>)
  )
)
