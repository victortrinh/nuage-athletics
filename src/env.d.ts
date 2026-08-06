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
    TURNSTILE_SECRET_KEY?: string
    STRIPE_SECRET_KEY?: string
    STRIPE_WEBHOOK_SECRET?: string

    // [vars] in wrangler.toml
    PUBLIC_SITE_URL?: string
    PUBLIC_TURNSTILE_SITE_KEY?: string
    // "true" to expose /produit/*, /en/product/* and /api/checkout. Everything
    // else returns 404 while this is unset — see src/lib/commerce/index.ts.
    COMMERCE_ENABLED?: string
  }
}

type Env = Cloudflare.Env
