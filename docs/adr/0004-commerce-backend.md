# 0004 — Commerce backend: Shopify headless

## Status

Accepted and implemented.

## Context

Nuage Athletics originally built a Stripe checkout path (`ProductActions` →
`/api/checkout` → Stripe Checkout → `/api/webhooks/stripe`) with no cart
(single-variant buy-now), no real inventory (every variant reported
`inStock: true` unconditionally), and no fulfillment path — no shipping
labels, no tracking, no shipping-confirmation email. Building a cart, real
inventory, label purchasing, tracking, and returns handling by hand was
estimated at 3–6 weeks of undifferentiated ops work with no brand value, and
every part of it was a place a Quebec-first, CASL-compliant, bilingual site
could quietly go out of compliance.

Alternatives evaluated and rejected during scoping
([#30](https://github.com/victortrinh/nuage-athletics/issues/30)):

- **Snipcart** — 2% of sales on top of processing fees, no label-purchasing
  or inventory.
- **Ecwid / Lightspeed** — shipping-label printing is unavailable to Canadian
  merchants on the platform, and its widget-embed model conflicts with this
  repo's zero-radius / RAC / no-`tailwind-merge` conventions.
- **Stripe kept, ops hand-built** with Shippo/Stallion Express — the 3–6 week
  build described above, all maintenance burden.
- **Shopify as a fully hosted storefront** — would replace or fork the
  FR-default, Charter-driven routing this repo is built around.

This ADR also corrects a stale premise: `CLAUDE.md`'s non-negotiable #5 used
to name "Lightspeed" as Stripe's likely successor. Ecwid — evaluated and
rejected above — is itself owned by Lightspeed, so that premise pointed at
the wrong candidate. `CLAUDE.md`'s stack line and non-negotiable #5 have
already been updated to name Shopify directly; this ADR is the durable record
of why.

## Decision

Shopify Basic as a **headless backend only**. The Astro site keeps rendering
every page exactly as before (FR at `/`, EN at `/en/`, zero-JS default, the
a11y suite); Shopify is reached exclusively through the Storefront API for
price/availability/cart/checkout-handoff, and through one webhook for
order-paid notifications. Shopify's admin is the operator surface for
inventory, order records, shipping-label purchase, tracking, and returns —
none of which this repo has code for.

Implementation, as landed:

- **Adapter seam stays the single production seam** —
  `src/lib/commerce/index.ts` (`getLiveProduct`, `readCart`, `mutateCart`),
  backed by `src/lib/commerce/shopify.ts` (raw `fetch` against the Storefront
  API, no SDK — the same reasoning that kept `stripe.ts` off the Stripe Node
  SDK: a Worker needs a custom HTTP client). Pages never import a provider
  directly (non-negotiable #5).
- **Removed**: `src/lib/commerce/stripe.ts`, `src/pages/api/webhooks/stripe.ts`,
  its test, and the `orders` table — all gone from the repo as of this
  writing.
- **Price and availability**: one Storefront API query per product render,
  joined to `catalogue.ts` copy by SKU, cached ~15 seconds. `catalogue.ts`
  carries no price field at all (non-negotiable 5.5) — not a placeholder,
  removed entirely.
- **Failure mode**: a failed Storefront call renders the existing
  `commerceEnabled={false}` state (no price, no buy band) rather than
  erroring or serving a stale price — see `getLiveProduct`'s `StorefrontReason`
  vocabulary and the `X-Storefront` response header.
- **Cart**: real multi-line cart (`src/pages/api/cart.ts`,
  `panier.astro`/`cart.astro`), cart id in an httpOnly cookie, no
  server-side cart record. Checkout is a redirect to Shopify's own hosted
  `cart.checkoutUrl` — no checkout UI is built in this repo.
- **Shipping**: weight-tiered flat rate configured in Shopify admin settings,
  not a code path — see the (removed) `stripe.ts` placeholder constants this
  superseded, and ADR-0006 for the `shipping` page that presents it.
- **Tax**: per ADR-0002.
- **Sizes**: `SIZES` in `catalogue.ts` is `['XXS','XS','S','M','L','XL','XXL']`
  — 7 sizes × 2 fits = 14 variants, landed before any Shopify inventory was
  loaded so SKUs didn't need re-keying.
- **Subscriber reconciliation**: Shopify checkout opt-ins are reconciled into
  `subscribers` via `src/pages/api/webhooks/shopify.ts` on `customers/create`
  / `customers/update`, under `SHOPIFY_CONSENT_VERSION` — never merged into
  or replacing `CONSENT_VERSION`, the site's own signup-form wording (see
  `src/lib/consent.ts`).
- **Gate/commerce interaction**: the old password-gated pre-launch state has
  since been removed entirely in favour of founder preview (see CONTEXT.md);
  the "never both true" guard this ADR originally called for no longer
  applies, since there is no `SITE_LOCKED` flag left to conflict with
  `COMMERCE_ENABLED`.

## Consequences

- Provider-swap non-negotiable (#5) remains intact: a future migration off
  Shopify is a new `StorefrontSource` implementation and a one-line change in
  `src/lib/commerce/index.ts`.
- `npm run shopify:check` and the `X-Storefront` header exist specifically
  because this design's failure modes (unconfigured store, un-joined SKU,
  refused token) are otherwise indistinguishable from an ordinary pre-drop
  render — see `CLAUDE.md` non-negotiable 5.5 for the full diagnostic
  contract.
- Any reference elsewhere in the repo's history (issues, old comments) to
  `stripe.ts`, `PLACEHOLDER_PRICE_CENTS`, or `SITE_LOCKED` describes a state
  this ADR has already superseded.
