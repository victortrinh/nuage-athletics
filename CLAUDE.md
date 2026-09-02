# CLAUDE.md — Nuage Athletics

Context for AI assistants working in this repo. Read before changing anything.

## What this is

Landing page + email capture for a single-SKU Canadian apparel brand. First drop
fall 2026. Commerce is scaffolded behind an adapter but not wired to any page.

**Stack:** Astro 7 (static output + SSR endpoints) · React islands (shadcn/ui on
React Aria Components) · Tailwind 4 · Cloudflare Workers · D1 · Resend · Turnstile ·
Stripe (phase 2)

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
   the swap should be one line in `src/lib/commerce/index.ts`. Product data lives
   in `src/lib/catalogue.ts`, which imports no payment provider — pages read it
   directly and the Stripe adapter reads it too.

5.5 **Never render a price while `COMMERCE_ENABLED` is off.** The number in
   `catalogue.ts` is a placeholder, and an advertised price is one a Quebec
   merchant is expected to honour. Set the real one before flipping the flag.

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

## Component library

`src/components/ui/` holds shadcn/ui primitives on the React Aria Components base
(`components.json` has `"base": "aria"`), hand-written rather than CLI-generated —
`ui.shadcn.com` is blocked by egress policy in the sandboxes this repo has been
developed in so far; check whether that still holds before assuming `npx shadcn
add <component>` will work, and if it does, treat the CLI's raw output as a diff
to reconcile against these files' existing conventions, not a replacement for them.

- **Variant tables (`*-variants.ts`) are plain `.ts`, zero React/RAC imports.**
  `.astro` files (`GateScreen.astro`, `Base.astro`) import `buttonVariants`,
  `inputVariants`, `labelVariants`, `fieldErrorVariants` from these directly —
  never from the `.tsx` primitives, which pull in `react-aria-components`.
  `scripts/check-guards.sh` (run by `npm run check`) enforces this.
- **This site has no radii, ever.** `--radius-*` are all `0` in `global.css`,
  which handles shadcn's own `rounded-*` classes, but a custom one-off
  (`rounded-[6px]`, say) would slip past that. `check-guards.sh` also greps for
  any `rounded` utility inside a `class`/`className` attribute — that's what
  actually catches it.
- **Focus is a hard offset outline, not a ring** (the WebGL sky washes soft
  rings out). Defined once as the `focus-block` utility in `global.css`, applied
  to native `:focus-visible` and to RAC's `data-[focus-visible]` attribute
  (`checkbox.tsx`, `radio-group.tsx` — their real `<input>` is visually hidden,
  so native `:focus-visible` never fires on the part you can see).
- **The CASL consent checkbox uses `isSelected`/`onChange(boolean)`, never
  `defaultSelected`** (`checked`/`onChange(event)` don't exist on RAC's
  `Checkbox`, and a stray one is silently dropped, not a type error).
  `check-guards.sh` greps for `defaultSelected` too.
- **A custom RAC indicator loses what a native control gets from the OS for
  free in forced-colors mode.** `checkbox.tsx`'s `forced-colors:` rules exist
  because of this — see `e2e/forced-colors.e2e.ts` before removing them.
- Eight shadcn semantic color names (`--color-background`, `--color-primary`,
  etc.) are aliased onto the six brand tokens in one flat `@theme` block — this
  site has no dark mode, so skip shadcn's usual two-layer `:root` +
  `@theme inline` split if a `shadcn add` tries to reintroduce it.
- No `tailwind-merge`, no `lucide-react`. `cn()` (`src/components/ui/cn.ts`) is
  `clsx` only — there's no conditional class-conflict resolution in this
  codebase to merge. Adding either back is a deliberate call, not a default.

## Accessibility

`npm run test:a11y` runs `@axe-core/playwright` across all 16 routes plus
behavioural assertions in `e2e/`, wired into CI (`.github/workflows/ci.yml`).
Two things worth knowing before touching it:

- **axe alone does not validate most hand-written accessibility fixes** — it
  can't know a field is in an error state, and `aria-pressed` on mutually
  exclusive buttons is valid ARIA even though it's the wrong widget. Treat it
  as a regression net for markup a component generates, and write an explicit
  Playwright assertion (`e2e/behavior.e2e.ts`) for anything it can't see.
- **`e2e/global-setup.ts` logs into the pre-launch gate** and saves
  `storageState` so the suite scans the real locked site. If you add a page
  behind the gate, it's covered automatically via `ROUTES` — nothing to update
  there. If you touch `src/lib/gate.ts` or `src/middleware.ts`, rerun
  `npm run test:a11y` locally before pushing: a broken gate breaks the whole
  suite's login step, not just one test.

## Verify before claiming done

```bash
npm run check     # tsc --noEmit (src/ and e2e/) + scripts/check-guards.sh
npm run build     # astro build
npm test          # vitest
npm run test:a11y # Playwright + axe — builds and runs its own wrangler dev
```

All four must pass. `test:a11y` is slower (it builds, migrates a throwaway local
D1, and boots `wrangler dev` itself) — run it before claiming an accessibility or
`src/components/ui/` change is done, not on every unrelated edit.

Pages are **not** prerendered — every route under `src/pages` sets
`prerender = false`, because Workers serves a prerendered file straight from
static assets without invoking the Worker, and the password gate in
`src/middleware.ts` would never see it. So there is no `dist/client/index.html`
to inspect. Check the rendered response instead:

```bash
npx wrangler dev --local
curl -s localhost:8787/ | grep -o 'lang="fr-CA"\|hreflang="[^"]*"'
```

The French root must report `lang="fr-CA"` and carry three `rel="alternate"`
links (`fr-CA`, `en-CA`, `x-default`).

**`.dev.vars` is read by vitest too.** Setting `TURNSTILE_SECRET_KEY` there makes
`subscribe.ts` start verifying challenges the tests never send, and the suite
fails with 400s that look like a code bug. Leave it commented out unless you are
deliberately exercising Turnstile.
