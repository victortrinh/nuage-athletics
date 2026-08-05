# CLAUDE.md — Nuage Athletics

Context for AI assistants working in this repo. Read before changing anything.

## What this is

Landing page + email capture for a single-SKU Canadian apparel brand. First drop
fall 2026. Commerce is scaffolded behind an adapter but not wired to any page.

**Stack:** Astro 7 (static output + SSR endpoints) · React islands · Tailwind 4 ·
Cloudflare Workers · D1 · Resend · Turnstile · Stripe (phase 2)

## Non-negotiables

These look like arbitrary choices and are not. Do not "simplify" them.

1. **French is the default locale and lives at `/`.** English is at `/en/`.
   Quebec's Charter of the French Language requires the French version on terms
   at least as favourable as any other language. Never move FR behind `/fr`,
   never make EN the root, never let a page exist in EN only.

2. **`Dict` in `src/i18n/ui.ts` is exhaustive by design.** Adding a string means
   adding both locales. If you find yourself widening the type or reaching for
   `Partial<Dict>`, stop — a partial French site is a compliance problem.

3. **Never pre-check the consent checkbox and never infer consent.**
   `src/pages/api/subscribe.ts` requires `z.literal(true)`. CASL demands express
   consent with the burden of proof on the sender.

4. **Never backfill `consent_version` or drop the consent columns.** Each row
   records the wording that specific subscriber saw. Rewriting it destroys the
   only evidence of what they agreed to. Bump `CONSENT_VERSION` in
   `src/lib/consent.ts` when wording changes; leave old rows alone.

5. **Nothing under `src/pages` imports Stripe directly.** Commerce goes through
   `CommerceAdapter` (`src/lib/commerce/`). Lightspeed may replace Stripe later;
   the swap should be one line in `src/lib/commerce/index.ts`.

6. **Every commercial email needs sender name, mailing address and unsubscribe.**
   See `SENDER_IDENTITY` in `src/lib/consent.ts`. CASL requires all three.

## Environment gotchas

- **Bindings come from `import { env } from 'cloudflare:workers'`.**
  `Astro.locals.runtime.env` was removed in Astro 6. Types merge into
  `Cloudflare.Env` in `src/env.d.ts`.
- **Do not add `pages_build_output_dir` to `wrangler.toml`.** The adapter targets
  Workers; that key makes wrangler treat it as a Pages project, where `ASSETS`
  is reserved and the build fails.
- **Do not add `main` to `wrangler.toml`.** It is validated before the build
  output exists.
- **`astro check` does not work.** TypeScript 7 dropped the programmatic API the
  Astro language server needs. Use `npm run check` (`tsc --noEmit`).

## Conventions

- Localised URLs live in `ROUTES` (`src/i18n/utils.ts`). Add a route there first;
  `Seo.astro` derives canonical + hreflang from it automatically.
- API routes need `export const prerender = false`.
- React islands only where interaction requires it. Default to zero JS.
- Tailwind utility classes inline; no component CSS files.
- Conventional commit prefixes. Commit bodies explain *why*, not what.

## Verify before claiming done

```bash
npm run check   # tsc --noEmit
npm run build   # astro build
```

Both must pass. `dist/client/index.html` should contain `<html lang="fr-CA">`
and three hreflang links.
