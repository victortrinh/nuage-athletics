# 0006 — Page inventory: what exists, what's planned, what's deliberately absent

## Status

Accepted. The "planned" rows below (`returns`, `shipping`) are designed but
**not yet built** — tracked in
[#47](https://github.com/victortrinh/nuage-athletics/issues/47). This ADR
records the rejections and the planned pages together, per that issue's own
sequencing note, rather than only the pages that exist today.

## Context

The audit compared this site's route table against two reference storefronts
(Yeezy's footer, Saalt Studio's menu) — thirteen distinct pages between them
([#10](https://github.com/victortrinh/nuage-athletics/issues/10)). Most of
those pages don't apply here, and each rejection is a question someone will
ask again while looking at a competitor's site. "We already decided" is only
useful if the reason survived the asking.

## Decision

### Existing route ids (`ROUTES` in `src/i18n/utils.ts`)

| Route id | fr-CA | en-CA | `INDEXABLE` | Notes |
|---|---|---|---|---|
| `home` | `/` | `/en/` | **true** | The only indexable routes today. |
| `privacy` | `/confidentialite/` | `/en/privacy/` | false | Draft, pending legal review (ADR-0001/0003 for the missing address, ADR-0001 for a named *responsable de la protection des renseignements personnels*). |
| `terms` | `/conditions/` | `/en/terms/` | false | Draft, pending legal review and a real merchant-identity block (ADR-0001). |
| `precontract` | `/informations-precontractuelles/` | `/en/pre-contract-information/` | false | Quebec LPC pre-contract distance-sale disclosures. Was a `<details>` on the product page (`CpaDisclosure.astro`); is now its own page, linked from the footer, the nav drawer, and directly under the buy control. |
| `confirmed` | `/inscription-confirmee/` | `/en/confirmed/` | false | Dead end reached only from a confirmation email link; nothing on it is worth ranking. |
| `unsubscribed` | `/desabonnement/` | `/en/unsubscribed/` | false | Same reasoning as `confirmed`. |
| `cart` | `/panier/` | `/en/cart/` | false | A visitor's own working cart; nothing on it is worth ranking. |

Plus the **product page**, not keyed in `ROUTES` because its slug is part of
the catalogue and differs per locale (`productPath`/`productAlternates` in
`src/i18n/utils.ts`, slugs in `src/lib/catalogue.ts`'s `SLUGS`). It renders
publicly with no price/buy band while `COMMERCE_ENABLED` is off, per
non-negotiable 5.5.

**Current total: 7 route ids + the product page = 8 templates × 2 locales =
16 pages.**

### Planned route ids (designed, not yet built — #47)

| Route id | fr-CA | en-CA | `INDEXABLE` (at first) | `SHOWS_SIGNUP_PROMPT` |
|---|---|---|---|---|
| `returns` | `/retours/` | `/en/returns/` | false | true |
| `shipping` | `/livraison/` | `/en/shipping/` | false | true |

Content, per the policy already decided in
[#30](https://github.com/victortrinh/nuage-athletics/issues/30):

- **`returns`**: 30 days from delivery, unused with tags, customer pays
  return shipping, exchange handled as return-and-reorder (no direct swap, no
  inventory held back), sale items final. Plus an **order-changes** section
  on this same page (see "Folded in," below) carrying the LPC pre-shipment
  cancellation right already stated on the `precontract` page.
- **`shipping`**: the weight-tiered flat rate from #30 (once the bands are
  set), Canada only (matching the existing `shipping_address_collection`
  restriction), and the delivery-delay terms already on the `precontract`
  page (terminate if undelivered 30 days after the agreed date). No prices
  render on this page while `COMMERCE_ENABLED` is off — non-negotiable 5.5
  applies to a shipping rate as much as to the product price.

Neither is added to any gate-bypass list: the pre-launch password gate that
`OPEN_PREFIXES` in `src/lib/gate.ts` once governed has been removed entirely
(see CONTEXT.md's "two real gates" section) — this concern from the original
#47 scoping no longer applies.

**Resulting inventory once #47 lands: 9 route ids + the product page = 10
templates × 2 locales = 20 pages.**

### Shopify policy-slot mapping

Shopify auto-links these slots in its hosted checkout footer whether or not
they're filled, so each slot has to point at the equivalent page here rather
than a Shopify default:

| Shopify policy slot | Route |
|---|---|
| Refund policy | `returns` |
| Shipping policy | `shipping` |
| Privacy policy | `privacy` |
| Terms of service | `terms` |
| Contact information | Footer `mailto:` + the merchant-identity block (out of scope for #47 — needs ADR-0001/0003's real values first) |

This is why `returns` and `shipping` are two pages rather than one combined
"Livraison et retours" page: combining them would leave one of the two
Shopify slots pointing at a default or at nothing.

### Rejected pages, and why

| Page | Reason rejected |
|---|---|
| **Accessibility statement** | No Canadian or Quebec law requires one from a private retailer — the ACA covers federally regulated entities, AODA is Ontario at 50+ employees. Yeezy's exists because of US ADA litigation exposure, which doesn't apply here. This site's accessibility work is real and tested (`npm run test:a11y`); a page claiming an unaudited conformance level would be a liability, not a benefit. |
| **DNSMPI ("Do Not Sell My Personal Information")** | A California CCPA/CPRA concept, not a Law 25 one. Publishing it would imply a data-sale practice this business does not have. |
| **Cookies page** | Follows from ADR-0005: there is no cookie banner because there is nothing to disclose. |
| **Order status / order lookup** | Shopify already owns this (order status page on the hosted checkout domain). Rebuilding it here means standing up an order-lookup surface and taking on Law 25 exposure to duplicate something already provided. |
| **About us** | Not rejected — **deliberately deferred**, tracked in [#8](https://github.com/victortrinh/nuage-athletics/issues/8) ("AI SEO"). It's the page a language model would cite for entity grounding, but `home`/`en` are currently the only indexable routes, so there's nothing yet for an about page to support. Revisit once more of the site is indexable. |
| **Login / register** | Guest checkout (Shopify's hosted flow) covers the purchase path. Accounts would add authentication, stored personal data, and password resets for a single-SKU, single-drop business — cost with no corresponding benefit yet. |
| **Order changes (as its own route)** | Folded into `returns` as a section, not a separate page (see above). A page nobody links to on its own is worse than a heading someone actually finds on the page they already went to; the person asking "can I change my order" and the person asking "can I return it" are usually the same person at the same moment. |

## Consequences

- A route added to `ROUTES` is a type error in `INDEXABLE` and
  `SHOWS_SIGNUP_PROMPT` until answered (`Record<RouteId, boolean>` — see the
  comments in `src/i18n/utils.ts`), so this table can drift out of sync with
  the type system but never silently miss a route entirely; `npm run check`
  is the backstop.
- `e2e/a11y.e2e.ts` parameterises axe over `ROUTES` automatically — adding
  `returns`/`shipping` needs no test-file change, only the route-table
  entries.
- If a future audit reconsiders any rejected page (most plausibly "about us"
  once #8 is acted on, or "accessibility statement" if the ACA's scope ever
  changes), update this ADR's Decision section rather than opening a fresh
  one — the reasons recorded here are what would need to change first.
