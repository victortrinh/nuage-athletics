/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

/**
 * Per-request state. `cartCount` is set by the two places that have just
 * read the real cart — `applyCheckoutReturn` (src/lib/cart.ts) and the cart
 * pages themselves — so src/layouts/Base.astro can render the header count
 * from that read rather than from the request's now-stale count cookie.
 * Absent on every other request, which is the ordinary case: the cookie is
 * right and no Storefront call was made.
 */
declare namespace App {
  interface Locals {
    cartCount?: number
  }
}

/**
 * Worker bindings.
 *
 * Astro 6+ removed `Astro.locals.runtime.env`. Bindings are read with
 * `import { env } from 'cloudflare:workers'`, which is typed against
 * `Cloudflare.Env` — declaration-merged below. Keep in sync with wrangler.toml.
 *
 * `wrangler types` can generate this automatically once the D1 database exists.
 */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database

    // Secrets — wrangler secret put <NAME>
    RESEND_API_KEY?: string
    // The founder-preview password. A secret, never a [vars] entry — a
    // password committed to wrangler.toml is a password in the git history.
    PREVIEW_PASSWORD?: string
    // Shopify Storefront API — with the store domain in [vars] below, this
    // token is the only source of a customer-visible price and of
    // per-variant availability (src/lib/commerce/shopify.ts). Unset means no
    // price and no buy band, whatever COMMERCE_ENABLED says.
    SHOPIFY_STOREFRONT_TOKEN?: string
    // Verifies the order-paid webhook's X-Shopify-Hmac-Sha256 signature
    // (src/pages/api/webhooks/shopify.ts). Set in the Shopify admin webhook
    // subscription and here — the two must match.
    SHOPIFY_WEBHOOK_SECRET?: string

    // [vars] in wrangler.toml
    PUBLIC_SITE_URL?: string
    // "true" to show prices and the buy flow to everyone. While it is unset
    // only a visitor carrying the preview cookie sees them, and /api/cart
    // returns 404 for everyone else — see src/lib/commerce/index.ts.
    COMMERCE_ENABLED?: string
    // The Shopify store, host only — no scheme, no path. A var rather than a
    // secret on purpose: it is public on any storefront URL, and shipping it
    // with the code is what keeps it from going missing on a Worker version
    // while the page renders as if the drop hadn't opened.
    SHOPIFY_STORE_DOMAIN?: string
  }
}

type Env = Cloudflare.Env
