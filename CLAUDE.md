# CLAUDE.md — Nuage Athletics

Context for AI assistants working in this repo. Read before changing anything.

## What this is

Landing page + email capture for a single-SKU Canadian apparel brand. First drop
fall 2026. Commerce is scaffolded behind an adapter but not wired to any page.

**Stack:** Astro 7 (static output + SSR endpoints) · React islands (shadcn/ui on
React Aria Components) · Tailwind 4 · Cloudflare Workers · D1 · Resend ·
Shopify (headless — Storefront API for price/availability/cart, one webhook
for order-paid)

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

   A Shopify checkout opt-in is a *different* wording than the site's own
   signup form, so it gets its own version rather than sharing
   `CONSENT_VERSION` — `SHOPIFY_CONSENT_VERSION` and `SHOPIFY_CHECKOUT_CONSENT`
   in `src/lib/consent.ts`, one version label mapping to exactly one wording.
   `src/pages/api/webhooks/shopify.ts` reconciles these opt-ins into
   `subscribers` on `customers/create` / `customers/update` — see that route's
   comment for why those topics and not the more obviously-named
   `customers/email_marketing_consent/update` (issue #35). Rows it inserts
   carry `source = 'shopify-checkout'` and land pre-`confirmed` (checkout
   consent is express consent, so there's no double opt-in to wait on); the
   insert's `ON CONFLICT(email) DO NOTHING` means it can never touch a row
   that already exists under any status. This is a webhook, not a script or a
   cron: there is deliberately no tool to backfill opt-ins that predate the
   webhook subscription — building one would need a `read_customers` Admin
   API token (reads every customer's PII) to import what is currently zero
   rows. If a backfill is ever actually needed, write it then.

5. **Nothing under `src/pages` imports a commerce provider directly.** Commerce
   goes through the storefront seam in `src/lib/commerce/index.ts`
   (`getLiveProduct`, `readCart`, `mutateCart`), backed today by Shopify's
   `StorefrontSource` (`src/lib/commerce/shopify.ts`). A future provider swap
   means a new `StorefrontSource` implementation and a one-line change in
   `index.ts`. Product *copy* lives in `src/lib/catalogue.ts`, which imports no
   commerce provider — pages read it directly, and the adapter reads it too.
   Price and availability are not copy; see 5.5.

5.5 **The price comes from Shopify or it does not exist.** `catalogue.ts`
   holds no price at all — `PLACEHOLDER_PRICE_CENTS` is gone, and putting a
   number back there is the regression this rule now guards against. An
   advertised price is one a Quebec merchant is expected to honour, and the
   only number anyone can honour is the one the Storefront API answers with
   (`src/lib/commerce/shopify.ts`, joined to the catalogue by SKU, cached
   ~15s). `getLiveProduct()` (`src/lib/commerce/index.ts`) is the single seam:
   it returns the priced product or **null**, and null covers every reason
   there isn't one — commerce off, no preview cookie, Shopify unreachable,
   SKUs that don't join, a price in the wrong currency. `ProductView.astro`
   takes that nullable product rather than a `commerceEnabled` boolean, so a
   Storefront outage renders the pre-drop page (no price, no buy band) and
   there is no code path that renders a band without a Shopify price behind
   it. Adding a line re-resolves the variant from this same read
   (`resolveMerchandiseId()` in `src/pages/api/cart.ts`) rather than trusting
   whatever id the request carried, and checkout is a redirect to Shopify's
   own hosted `cart.checkoutUrl` — so what was rendered and what ends up in
   the cart cannot disagree.

   The cost of that design is that every failure looks like an ordinary
   pre-drop page. So the two silent ones say so in the Worker log (an
   unconfigured store, and a read that joined no SKU — the latter names the
   SKUs it looked for), and `npm run shopify:check` runs the same query and
   the same join outside the Worker: it tells a refused token from products
   that aren't published to the token's sales channel from a SKU that doesn't
   match. Reach for it before assuming the site is broken.

   In a browser the same question is answered by two response headers, which
   is all the render will tell you: `Cache-Control: private, no-store` means
   the preview cookie is live (5.6 — nothing else in the codebase sets it),
   and `X-Storefront: no-domain | no-token | unreachable | no-match` appears
   only when commerce was on for that request and no price came back — the
   first two name the binding the serving Worker is missing. `no-token` is
   the live one: `SHOPIFY_STOREFRONT_TOKEN` is a secret, and
   `npx wrangler secret list` confirms whether it reached the Worker.
   `unreachable` carries the refusal with it — `unreachable;status=401` is the
   token, `;status=404` the domain or a retired API version, `;graphql` a
   field the token may not read, `;network` a call that never left the
   machine. `no-domain` should be unreachable now that `SHOPIFY_STORE_DOMAIN` is a
   `[vars]` entry in `wrangler.toml` — it ships with the code precisely so a
   deployed version cannot be missing it; seeing it means the entry was
   removed. The header
   names a category, never a credential, and the *render* stays identical to
   launch day — which is what keeps this from widening preview.

5.6 **Preview is per-visitor, so a preview render must never be cached.**
   `commerceEnabled()` (`src/lib/commerce/index.ts`) answers yes either because
   `COMMERCE_ENABLED` is on for everyone or because this one visitor carries the
   founder-preview cookie. Since that answer gates a *price*, `applyPreview()`
   (`src/lib/preview.ts`) stamps `Cache-Control: private, no-store` on any
   response rendered in preview. Nothing else in the codebase sets
   `Cache-Control`, so this is currently belt and braces — which is exactly why
   it must survive the day someone adds caching.

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
- **Tailwind 4's preflight does not restore `cursor: pointer` on buttons.** It
  matches the browser default (an arrow) instead. `global.css` states the rule
  once for `button`/`summary`/`[role=button]`; a `<label>` that *is* the control
  (checkbox.tsx, radio-group.tsx) still has to say `cursor-pointer` itself,
  because no selector can tell those apart from an ordinary label.
- **The Cloudflare Workers Builds GitHub integration comments on every push**
  (`cloudflare-workers-and-pages[bot]`, posted as `issue_comment.created` then
  edited to `issue_comment.edited` once the build finishes). This is pure
  status noise — the same result is already the `Workers Builds:
  nuage-athletics` check run. When watching a PR, don't investigate or reply
  to this bot's comments; just note the deploy status from the check run and
  move on.

## Founder preview

The pre-launch password gate is gone; the home page is public and announces the
drop instead (`dropAnnounceFirst` / `dropAnnounceAvailability` in
`src/i18n/ui.ts` — the availability line is the one string per locale to change
when the date firms up). What replaced the gate is narrower: a way for the four
of us to see the real buy flow on the real site before it opens.

- `/?preview=<PREVIEW_PASSWORD>` on any path sets a signed cookie and redirects
  to the same path with the secret stripped, so it does not linger in history
  or leak through `Referer`. `/?preview=` (empty) leaves preview again.
- Wrong guesses are rate-limited through the same limiter the gate used
  (`gate_attempts`, kept under its original name) and answered with 404 rather
  than 401, so a guess does not confirm preview exists.
- The cookie carries a signed expiry, never the password. Rotating
  `PREVIEW_PASSWORD` invalidates every session already handed out.
- Preview turns on commerce **only** — same render as launch day, nothing else
  diverges. Resist widening it: every extra conditional is a way for what you
  tested to differ from what ships.

## Conventions

- Localised URLs live in `ROUTES` (`src/i18n/utils.ts`). Add a route there first;
  `Seo.astro` derives canonical + hreflang from it automatically. Then say
  whether it may be indexed in `INDEXABLE`, in the same file — it is
  `Record<RouteId, boolean>`, so a new route won't compile until you do. That
  one answer drives both the page's `robots` meta and whether the URL reaches
  the sitemap, which is why pages no longer pass `noindex` themselves.
- API routes need `export const prerender = false`.
- React islands only where interaction requires it. Default to zero JS.
- Tailwind utility classes inline; no component CSS files.
- Conventional commit prefixes. Commit bodies explain *why*, not what.
- **The garment isn't final, so the public pre-drop page shows no
  photography at all** — not the carousel, not a static image, nothing under
  `public/img/ls-01-*`. `ProductView.astro`'s `!live` branch is the drop
  announcement instead, and nothing else: `dropAnnounceFirst`/
  `dropAnnounceAvailability` (`src/i18n/ui.ts`) *is* the page's one `<h1>`,
  centred over the sky, generic on purpose ("first drop", not which one —
  naming the garment would be a label with nothing to label without a
  photo). There's no separate brand-name heading above it — the header's
  own logo link already carries `aria-label={d.brand}` (`Base.astro`), so
  repeating "Nuage Athletics" here would say the same fact twice on every
  render rather than heading this page's own content. `ProductStage.tsx`
  (carousel, fit picker, buy band) only ever mounts inside the `live` branch
  now, so its
  `Props` are plainly required — there's no `commerceEnabled: false` arm to
  keep in sync any more, and no code path constructs the island without a
  real Shopify price and real photography behind it. Founder preview is the
  only way to see the garment before the design is final: turning it on
  doesn't just reveal the buy band, it's the only render with a photograph
  in it. (An earlier version of this page pinned the pre-drop and preview
  renders to the same photo, pixel-for-pixel, via a hand-measured
  reservation in `ProductView.astro` and a shared `CHROME_REM` in
  `ProductStage.tsx` — that pairing and its `e2e/behavior.e2e.ts` test are
  gone along with the public photo they existed to keep in place.)
- The product's **fit** (`FitId` in `src/lib/catalogue.ts`) is a purchasable
  axis alongside size, not just a photo toggle — 12 variants, fit × size.
  `ProductStage.tsx` is the one island for the whole interactive product
  body: carousel, fit picker, and the buy band (name, price, sizes, the
  add-to-cart button). Everything in the band is visible on arrival now —
  no `+` to open it, no "Détails" toggle swapping the sizes for a
  description panel. Only the price row and the button's own label
  ("Ajouter au panier" / "Ajout…") still roll (`product/Slot.tsx`), so an
  error or the button's progress can't change the band's height. There is
  no "Added" state any more — the confirmation moved out of the band
  entirely: a successful hydrated add (`onSubmit` in `ProductStage.tsx`)
  bumps the header cart link (`#cart-link`, `Base.astro`) in place — its
  count and `aria-label` update from the same readable `na_cart_n` cookie
  `/api/cart` just set, and it answers with `.cart-bump` (`global.css`): a
  short scale bump plus a circle pulsing out of it. That circle starts at
  `focus-block`'s own 4px offset in the same 2px accent-ink stroke and
  travels 8px outward, expanded by animating `outline-offset` rather than
  `scale` — a scaled outline thickens and blurs as it grows, and an outline
  follows its box's radius, so the stroke stays hard the whole way out. It
  is drawn on a square pseudo-element sized off the link's own height, not
  an `inset: 0` one, since a radius on a box that grows with its count
  would draw an ellipse. Both
  parts are reduced-motion-gated and the cart page's steppers reuse the
  same class, so every cart change answers identically wherever it came
  from. `e2e/cart-motion.e2e.ts` pins that it fires (and re-fires on a
  second add) with motion allowed; `behavior.e2e.ts` pins that it doesn't
  under `reduce` — the count changing is what carries the information.
  Adding deliberately does **not**
  navigate to the cart: someone buying two fits or three sizes shouldn't
  have to walk back from the cart between each one. It was tried the other
  way and reverted for exactly that reason — don't reintroduce it. The
  no-JS fallback lands back on the product page too (`added=1`), which the
  page reads for nothing; it just renders the ordinary idle band. The
  description and spec list moved out
  of the band entirely, onto an always-open section below the fold
  (`ProductDetails.astro`, still gated on `commerceEnabled`) — there's
  nothing left to disclose into. The size row is seven identically sized,
  unboxed buttons — they stretch to fill their own grid column and carry no
  background until one is selected (`tight` density in
  `ui/radio-group.tsx`), so the row reads as lettering rather than seven
  boxes the width of their own labels. The prev/next carousel arrows sit
  *beside* the frame, not pinned inside its edges: a 2:1 flat-lay in a 2:1
  frame leaves no margin for them to land in, so inside they sat on the
  garment. The room for them is bought from the frame's own width cap from
  `md:` up, which is where they render at all. It used to be two islands —
  `ProductCarousel.tsx` and `ProductActions.tsx`, in separate grid columns,
  sharing the selected fit through a module-level store
  (`src/lib/fit-store.ts`) because they had no common parent to lift state
  into. That store is gone. `ProductCarousel` is still its own component
  for the sake of its self-contained drag/keyboard/pagination logic, but
  it's a plain child of `ProductStage`, not a second island — `fit` and its
  setter come down as props.
  A sold-out size is struck through and dimmed (`data-[disabled]` in
  `ui/radio-group.tsx`), carries "— Épuisé" in its accessible name, and
  says the same word visibly in a CSS-only tip on hover. Three renderings
  of one fact, and each is there for someone the others miss: the
  strikethrough for the glance, the name for a screen reader, the tip for
  the pointer user the strikethrough leaves guessing. The tip is a plain
  `group-hover` span, not RAC's Tooltip — overlay machinery would be the
  largest thing on the client bundle for one non-interactive bubble — and
  it is absolutely positioned, so the band's fixed height is untouched
  whether it shows or not. Hover lives on a wrapper because a disabled
  Radio has `pointer-events-none` and no hover of its own.
  "Ajouter au panier" adds a real line to a Shopify cart (`/api/cart`,
  `intent=add`) rather than buying now — see `src/pages/panier.astro` /
  `src/pages/en/cart.astro` and `CartView.astro`. Checkout, from the cart
  page, is a redirect to Shopify's own hosted `cart.checkoutUrl`; there is no
  checkout UI in this repo.
- **The cart page's steppers are progressively enhanced, not an island.**
  Each `+`/`−`/remove is a native `<form>` POST to `/api/cart` and still is
  with no JS — the 303 back to the cart page is the whole mechanism there.
  `CartView.astro`'s own `<script>` intercepts those submits once hydrated
  and, rather than re-rendering anything itself, lets `fetch` follow that
  same 303 and swaps `#cart-body` for the one in the response, syncing
  `#cart-link` from the same document. So prices, the `−` button's flip to
  `remove` at quantity 1, and the empty-cart state are still rendered
  exactly once, server-side, by this file — there is no second
  implementation on the client to drift out of step, and no React on this
  route. Three things the swap has to keep doing, all asserted in
  `e2e/behavior.e2e.ts`: focus returns to the control that was pressed (or
  the `h1`, when a remove took that control away), the announcement goes
  through `#cart-status` **outside** the swapped region (a live region that
  was itself just replaced announces nothing), and the whole thing still
  degrades — the no-JS half of that contract has its own assertions in the
  JavaScript-disabled test. The checkout form deliberately carries no
  `data-cart-form`, since it must stay a real navigation to Shopify.
  The Quebec CPA pre-contract disclosure that used to sit in a closed
  `<details>` at the bottom of this page (`CpaDisclosure.astro`) is now its
  own route (`precontract` in `ROUTES`), linked from the footer, the nav
  drawer, and a line directly under the buy button — that last link matters
  for CPA s. 54.4, which wants the disclosure presented before the distance
  contract forms, and checkout hands off to Shopify's hosted page from here.
  The frame still sizes and caps the photo itself — none of that math
  changed — but the slide is clipped to the page's width, not the frame's:
  `ProductCarousel.tsx` measures the page and centres a wider clip layer
  on the frame, so paging moves the photo all the way across the viewport
  instead of stopping at the frame's own edge. The prev/next arrows sit
  above that layer (`relative z-10`), which is what keeps them clickable
  once it extends past them.
- **The sky is allowed to stop; it is never allowed to leave a white page.**
  `sky/engine.ts` walks a degrade ladder and eventually gives up (hiding the
  canvas, dropping the GL context, recording `na-sky-gaveup`), and three rules
  keep that from reading as a broken site. The `sky-fallback` layer under the
  canvas (`global.css`) is a drawn overcast deck, not a wash — it is the whole
  background for reduced-motion, forced-colors and no-WebGL2 visitors, and its
  densest tone deliberately tracks the shader's own `CLOUD_MIN` so the two
  read as the same weather; `prefers-contrast: more` flattens it to paper
  instead. The give-up flag carries a timestamp and expires, so one bad minute
  can't retire the sky for a whole browsing session. And `Sky.astro` mirrors
  any non-running state into `#sky-toggle`'s label — *in memory only*, never
  through `setStoredPause()`, which would persist a runtime verdict as if the
  visitor had chosen it. The degrade ladder itself charges a leaky bucket the
  time each frame runs *past* budget, capped per frame: an average of raw
  frame times let one GC pause spend most of the allowance and cost the sky a
  tier on hardware that was never slow.

## Component library

`src/components/ui/` holds shadcn/ui primitives on the React Aria Components base
(`components.json` has `"base": "aria"`), hand-written rather than CLI-generated —
`ui.shadcn.com` is blocked by egress policy in the sandboxes this repo has been
developed in so far; check whether that still holds before assuming `npx shadcn
add <component>` will work, and if it does, treat the CLI's raw output as a diff
to reconcile against these files' existing conventions, not a replacement for them.

**react-aria-components stays.** It was flagged once as a possible violation of
"default to zero JS" (above) and of SEO. Neither holds: Astro server-renders
every island to full HTML before any hydration runs, so the crawlable content —
headings, descriptions, the spec list, `Seo.astro`'s JSON-LD, `ProductView.astro`'s
`<noscript>` image grid — is in the first response regardless of what hydrates
afterward, and React only appears on two of sixteen routes in the first place
(`SignupForm`, `ProductStage`). What RAC buys — roving-
tabindex radiogroups, forced-colors indicators, live-region announcements, focus
restoration — is pinned by ~30 assertions in `e2e/`; hand-rolling the same
behaviour in vanilla JS to save the bundle weight would trade a tested layer for
an untested one. `scripts/check-bundle.sh` (run in CI after `npm run build`, not
part of `npm run check`) puts a number on that weight instead — it gzips every
`dist/client/_astro/*.js` file and fails past a budget, so a regression here is
a build failure, not a hunch.

The real gap the migration left was narrower: **an island that wraps a `<form>`
must degrade to a working native POST**, method/action and all, with hidden
fields for whatever its hydrated `fetch()` call sends explicitly. `SignupForm.tsx`
is the reference: `/api/subscribe` branches on `Content-Type` and answers a
form-encoded POST with a 303 back to the referring page (`redirect` field,
validated by `safeRedirect()` in `src/lib/preview.ts`) with the outcome folded into
that page's query string (`sent=1` / `se=<code>`) rather than JSON, since a
no-JS submit can't stay on the page to render one. The page reads that back out
of `Astro.url.searchParams` and passes it into the form as `initialSuccess` /
`initialErrorCode`, so the server render and the first client render agree and
there's nothing for hydration to reconcile. Anti-abuse on this endpoint is the
honeypot field, the per-IP rate limit, and double opt-in, backed by a
same-origin check (`isSameOrigin` in `subscribe.ts`) on top of Astro 7's own
`checkOrigin` middleware, which already rejects a cross-origin form POST before
any route handler runs — no bot-verification widget, which would need JS to
render at all and so could never cover the no-JS path anyway.

An island that starts inside something hidden and switches from `client:load`
to `client:visible` gets its hydration deferred until that ancestor gets a
layout box, not before — real savings on a band most visitors never see
(`SignupPrompt.astro`, revealed ~6s after load). But `client:visible` starting
hydration only *then*, instead of well before any interaction (as `client:load`
does), opens a real if narrow window where a fast click on the now-visible
control lands before React's own handlers attach — `e2e/behavior.e2e.ts`'s
`openSignupPrompt()` waits for the island to drop its `ssr` attribute (Astro's
own hydration-complete signal) before interacting, for exactly this reason.
`ProductStage` doesn't get this treatment — it's the first thing in the
document on every route that renders it, so there's no hidden ancestor to
defer behind; it stays `client:load`.

- **Variant tables (`*-variants.ts`) are plain `.ts`, zero React/RAC imports.**
  `.astro` files (`GateScreen.astro`, `Base.astro`) import `buttonVariants`,
  `inputVariants`, `labelVariants`, `fieldErrorVariants` from these directly —
  never from the `.tsx` primitives, which pull in `react-aria-components`.
  `scripts/check-guards.sh` (run by `npm run check`) enforces this.
- **This site has no radii, with exactly two exceptions.** `--radius-*` are all
  `0` in `global.css` except `--radius-full`, which is Tailwind's own value
  again so the product carousel's pagination dots can be dots
  (`ProductCarousel.tsx`) — the reference sets them round, and a 6px square
  reads as grit — and so the cart link's confirmation ring can be a ring
  (`#cart-link.cart-bump::after`, same file). Both are things that are
  circles or they are nothing. That token is not a general reopening:
  `check-guards.sh` fails the build on any `rounded` utility in a
  `class`/`className` attribute, in a quoted string in a `.tsx`/`.astro`
  file (which is how a multi-line `cn()` call carries one), *or* as a
  declared non-zero `border-radius` anywhere in `src/` — CSS included —
  unless the line also carries the marker `guard-allow-rounded`. Exactly
  two lines do today. Adding a third is a design decision that has to be
  written next to the declaration and shows up in a diff as one; a circle
  drawn some other way to dodge the grep is the regression this is here to
  catch.
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
- **Hover and press live in two utilities, not per-component classes.** `press`
  (global.css) is the whole pointer response for a control — eased colour and a
  1px sink — and *replaces* `transition-colors` rather than joining it, since
  both set `transition-property` and one would silently win. `underline-sweep`
  is the link equivalent and carries its own colour easing for the same reason.
- **Anything that moves is gated with `motion-safe:`, never
  `motion-reduce:transition-none`.** Removing the transition still leaves the
  element jumping to the offset; a reduced-motion preference is about the
  movement, not its timing. `e2e/behavior.e2e.ts` asserts the wordmark's dot
  doesn't move under `reduce`, `e2e/sky-motion.e2e.ts` that it does otherwise —
  that project is the only one running with real motion preferences.
- No `tailwind-merge`, no `lucide-react`. `cn()` (`src/components/ui/cn.ts`) is
  `clsx` only — there's no conditional class-conflict resolution in this
  codebase to merge. Adding either back is a deliberate call, not a default.

## Accessibility

`npm run test:a11y` runs `@axe-core/playwright` across all 14 routes plus
behavioural assertions in `e2e/`, wired into CI (`.github/workflows/ci.yml`).
Two things worth knowing before touching it:

- **axe alone does not validate most hand-written accessibility fixes** — it
  can't know a field is in an error state, and `aria-pressed` on mutually
  exclusive buttons is valid ARIA even though it's the wrong widget. Treat it
  as a regression net for markup a component generates, and write an explicit
  Playwright assertion (`e2e/behavior.e2e.ts`) for anything it can't see.
- **The suite scans the public site — there is no login step.** Every route in
  `ROUTES` × both locales is covered automatically, so a new page needs nothing
  added here. The scan sees the pre-drop render (no price, no buy panel), which
  is what the public gets; the buy flow behind founder preview is asserted
  explicitly in `e2e/behavior.e2e.ts` instead.

## Verify before claiming done

```bash
npm run check     # tsc --noEmit (src/ and e2e/) + scripts/check-guards.sh
npm run build     # astro build
npm test          # vitest
npm run test:a11y # Playwright + axe — builds and runs its own wrangler dev
```

All four must pass. `test:a11y` is slower (it builds, migrates a throwaway local
D1, and boots `wrangler dev` itself) — run it before claiming an accessibility or
`src/components/ui/` change is done, not on every unrelated edit. It also boots
`e2e/storefront-stub.ts`, a loopback stand-in for the Storefront API: without a
store to answer, founder preview would render the pre-drop page and every
assertion about the buy band would fail for the wrong reason. The stub serves
the real catalogue's SKUs and holds one size back as sold out. The *outage*
half of that contract is asserted in `test/shopify.test.ts` instead — it's
process-wide state on a server the parallel suite shares, so faking it in
Playwright would break every other spec for a cache window.

Pages are **not** prerendered — every route under `src/pages` sets
`prerender = false`, because Workers serves a prerendered file straight from
static assets without invoking the Worker. Two things depend on the Worker
running: founder preview in `src/middleware.ts` would never see the request,
and one build-time render would be cached and served to everyone — including
the preview render, price and all. So there is no `dist/client/index.html` to
inspect. Check the rendered response instead:

```bash
npx wrangler dev --local
curl -s localhost:8787/ | grep -o 'lang="fr-CA"\|hreflang="[^"]*"'
```

The French root must report `lang="fr-CA"` and carry three `rel="alternate"`
links (`fr-CA`, `en-CA`, `x-default`).

## Agent skills

### Issue tracker

GitHub Issues (`victortrinh/nuage-athletics`), via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
