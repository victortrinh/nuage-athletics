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
   public switch. Off: the home page renders the drop announcement, no price,
   no buy band. On: everyone gets the real buy flow. This is the flag that
   actually gates selling; the "fall 2026" copy on the home page is
   independent marketing text and does not, by itself, do anything (see the
   comment at `src/lib/commerce/index.ts:20-24`).
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

- A real price: landed cost (duty + freight on the China import, ADR-0002/ADR-0001)
  computed, then set in Shopify — `catalogue.ts` has no price field to fill in
  any more (non-negotiable 5.5).
- Real mailing address in `SENDER_IDENTITY.address` (`src/lib/consent.ts`) —
  currently the literal placeholder string, rendered live in six places
  (ADR-0003).
- CA dealer number or full dealer address for textile labelling on the
  physical garment (ADR-0003) — this blocks the product shipping, not the
  site rendering, but drop one cannot ship without it.
- `returns` and `shipping` pages built (#47, not yet landed — see ADR-0006)
  and their `INDEXABLE` flags flipped once legally reviewed, alongside
  `privacy`/`terms`/`precontract`, all currently `INDEXABLE: false` in
  `src/i18n/utils.ts`.
- Shopify's own policy slots (Refund/Shipping/Privacy/Terms/Contact) filled
  in both locales — see ADR-0006's slot-mapping table.
- Entity registered enough to hold a real merchant-identity block on the
  terms page and the precontract-disclosure page
  (`src/pages/informations-precontractuelles.astro` /
  `src/pages/en/pre-contract-information.astro`) — see ADR-0001.

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
does not have and why. Current state: 7 route ids × 2 locales = 14 pages
(`ROUTES` in `src/i18n/utils.ts`), plus the product page (its slug lives in
the catalogue, not `ROUTES`). `returns` and `shipping` (#47) are designed but
not yet built, which would bring the total to 9 route ids + the product page.

## Where the checklist lives

There is exactly one launch/selling checklist, in #44 on GitHub — not in
`README.md`, which used to carry two that drifted from it.
