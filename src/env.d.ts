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
    // The pre-launch gate's password. A secret, never a [vars] entry — a
    // password committed to wrangler.toml is a password in the git history.
    SITE_PASSWORD?: string
    STRIPE_SECRET_KEY?: string
    STRIPE_WEBHOOK_SECRET?: string

    // [vars] in wrangler.toml
    PUBLIC_SITE_URL?: string
    PUBLIC_TURNSTILE_SITE_KEY?: string
    // "true" to expose /produit/*, /en/product/* and /api/checkout. Everything
    // else returns 404 while this is unset — see src/lib/commerce/index.ts.
    COMMERCE_ENABLED?: string
    // "true" to put the whole site behind the password gate. Has no effect
    // unless SITE_PASSWORD is also set — see src/lib/gate.ts.
    SITE_LOCKED?: string
  }
}

type Env = Cloudflare.Env
