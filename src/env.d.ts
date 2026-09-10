/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

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
    STRIPE_SECRET_KEY?: string
    STRIPE_WEBHOOK_SECRET?: string
    // Shopify Storefront API — the only source of a customer-visible price
    // and of per-variant availability (src/lib/commerce/shopify.ts). The
    // store domain is a host, not a URL: "nuage-athletics.myshopify.com".
    // Both unset means no price and no buy band, whatever COMMERCE_ENABLED
    // says. The domain is a secret only by association: it is public on any
    // storefront URL, and it lives here so the pair is set and rotated
    // together rather than one in wrangler.toml and one out of it.
    SHOPIFY_STORE_DOMAIN?: string
    SHOPIFY_STOREFRONT_TOKEN?: string

    // [vars] in wrangler.toml
    PUBLIC_SITE_URL?: string
    // "true" to show prices and the buy flow to everyone. While it is unset
    // only a visitor carrying the preview cookie sees them, and /api/checkout
    // returns 404 for everyone else — see src/lib/commerce/index.ts.
    COMMERCE_ENABLED?: string
  }
}

type Env = Cloudflare.Env
