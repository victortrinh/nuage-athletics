# Nuage Athletics — Context

Single-context repo. See `docs/agents/domain.md` for how this file is meant to
be read, and `docs/adr/` for the decisions behind the answers below.

## The brand

Nuage Athletics is a single-SKU Canadian apparel brand: one long-sleeve shirt,
two fits (classic, crop) × seven sizes (XXS–XXL) = 14 variants. Designed in
Quebec, manufactured in China. First drop fall 2026. Four founders, no
incorporated entity yet — see ADR-0001.

## The entity (as of this writing)

Nothing is registered. "Nuage Athletics" trades informally, which under the
*Code civil du Québec* already makes the four founders a *société en nom
collectif* by default — joint and several liability, no paperwork filed. ADR-0001
records the recommendation (incorporate) and its status (**proposed**, awaiting
the founders). ADR-0002 covers tax posture, ADR-0003 the mailing address and
textile-labelling dealer identification. None of these are code changes; they
gate whether the site is allowed to go live, not whether it builds.

## The product

- Copy, images, alt text, sizes and fits: `src/lib/catalogue.ts`. No commerce
  provider import — see non-negotiable #5 in `CLAUDE.md`.
- Price and per-variant availability: Shopify's Storefront API, joined to the
  catalogue by SKU (`src/lib/commerce/shopify.ts`), never stored in this repo.
  There is no fallback price — see non-negotiable #5.5 and ADR-0004.
- Country of origin ("Made in China") is rendered as a compliance fact on the
  product page, not omitted or softened — see the spec list in
  `catalogue.ts` and ADR-0003 for the textile-labelling half of that
  obligation (fibre content + dealer ID on the physical garment, which this
  repo cannot render).

## The two real gates

Two independent flags decide what a visitor sees. There is no `SITE_LOCKED`
flag in this codebase — that concept (a password wall over the whole site)
was removed when the pre-launch gate became "founder preview"; if you find a
reference to `SITE_LOCKED` elsewhere (an older issue, a stale comment), it
describes a design this repo no longer has.

1. **`COMMERCE_ENABLED`** (`wrangler.toml` `[vars]`, currently `"false"`) — the
   public switch. Off: the home page renders the drop announcement, no
   photography, no price, no buy band. On: everyone gets the real buy flow.
   This is the flag that actually gates selling; the "fall 2026" copy on the
   home page is independent marketing text and does not, by itself, do
   anything (see the comment at `src/lib/commerce/index.ts:20-24`).
2. **Founder preview** (`PREVIEW_PASSWORD`, a secret) — a per-visitor override.
   `/?preview=<password>` sets a signed cookie that turns commerce on for that
   visitor only, so the four founders can exercise the real buy flow on the
   real site before `COMMERCE_ENABLED` flips for everyone. A preview render is
   never cached (`Cache-Control: private, no-store`) and is otherwise
   byte-for-byte what launch day renders — see "Founder preview" in
   `CLAUDE.md`.

`commerceEnabled()` in `src/lib/commerce/index.ts` is the single place that
answers "may this request see prices," combining both.

## What blocks each flag

**`COMMERCE_ENABLED = "true"`** needs, in order:

- The garment's design finalised. Unrelated to the flag mechanically, but
  the reason `COMMERCE_ENABLED` staying `"false"` is currently doing double
  duty: the public pre-drop page (`ProductView.astro`'s `!live` branch)
  shows no product photography at all, by design, not only no price — see
  CLAUDE.md's product-page bullet. Founder preview is the only render that
  shows the current photos while this is still open.
- A real price: landed cost (duty + freight on the China import, ADR-0002)
  computed, then set in Shopify — `catalogue.ts` has no price field to fill in
  any more (non-negotiable 5.5).
- `privacy`, `terms` and `precontract` rewritten for drop one's informal
  posture (#92) — draft banners removed, `INDEXABLE` flipped to `true` in
  `src/i18n/utils.ts`. **The address is a gate**: `SENDER_ADDRESS` (a
  Worker secret, not a repo constant — this repo is public) must be set
  before this flips, since the pre-contract page's CPA s. 54.4 (b) line
  reads from it via `senderAddressConfigured()` (#46, #67; ADR-0007
  amended 2026-09-15). No phone number is a gate — that's the one
  knowingly incomplete 54.4 item for drop one.
- Shopify admin configured to match (#93 — including the abandoned-checkout
  recovery email, now on since the footer has a real address) and its
  policy slots filled to mirror the rewritten pages, now including the
  `retours.astro` / `livraison.astro` pages #47 shipped (#66).
- Shopify's own customer notifications (order confirmation, shipping,
  abandoned checkout — #91) pasted into Settings → Notifications from
  `shopify/notifications/` and "Send test"-verified in both locales
  (`shopify/notifications/README.md`). Generated from `shopify/src/`;
  there's no API for notification template content, so this is a manual
  step no code path can flip for you.
- `#90`'s checkout-return fix verified on the paid-plan store.

ADR-0001's incorporation and ADR-0003's dealer-ID requirement are **not**
gates for drop one — see ADR-0007 for why, and #44 (the rewritten
checklist) for what's deferred instead. #47 (returns/shipping pages) was
pulled back into drop one's scope, same session ADR-0007 was amended a
second time — see its amendment note. ADR-0003's mailing-address
requirement **is** resolved for drop one (home address, via
`SENDER_ADDRESS`), not deferred.

**Founder preview** needs only `PREVIEW_PASSWORD` set and
`SHOPIFY_STOREFRONT_TOKEN` + `SHOPIFY_STORE_DOMAIN` configured against a store
that has this SKU's variants published — see `npm run shopify:check` and the
`X-Storefront` response header for diagnosing why a preview render still shows
no price.

## Commerce backend

Shopify, headless, Storefront API only, reached exclusively through
`src/lib/commerce/index.ts` (`getLiveProduct`, `readCart`, `mutateCart`). This
superseded an earlier Stripe-based checkout (`src/lib/commerce/stripe.ts`,
already removed from the repo) — see ADR-0004, which also corrects
`CLAUDE.md`'s old non-negotiable #5 commentary naming Lightspeed as Stripe's
likely successor (Lightspeed owns Ecwid, which was evaluated and rejected).

## Consent

Two separate consent ledgers feed one table (`subscribers`), each versioned
independently and never backfilled:

- `CONSENT_VERSION` (`src/lib/consent.ts`) — the site's own double opt-in
  signup form wording.
- `SHOPIFY_CONSENT_VERSION` / `SHOPIFY_CHECKOUT_CONSENT` — Shopify checkout's
  marketing opt-in wording, reconciled into `subscribers` by
  `src/pages/api/webhooks/shopify.ts` on `customers/create` /
  `customers/update`, rows landing pre-`confirmed` with
  `source = 'shopify-checkout'`.

## Page inventory

See ADR-0006 for the full table, including every page the site deliberately
does not have and why. Current state: 9 route ids × 2 locales = 18 pages
(`ROUTES` in `src/i18n/utils.ts`), plus the product page (its slug lives in
the catalogue, not `ROUTES`) — 10 templates × 2 locales = 20 pages total.
`returns` and `shipping` (#47) landed on top of #92's rewrite, mirroring the
pre-contract page's already-decided wording rather than the 30-day policy
ADR-0006 originally described.

## Where the checklist lives

There is exactly one launch/selling checklist, in #44 on GitHub — not in
`README.md`, which used to carry two that drifted from it.
