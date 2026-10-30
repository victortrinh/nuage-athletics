# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Runners and athletes in Quebec, reading the site in French first, who want a
training layer that isn't synthetic. Before the drop they arrive, learn what is
coming and when, and leave an email; at the drop they choose a fit and a size
and check out. English-reading Canadian visitors get the same site at `/en/`.

## Product Purpose

Nuage Athletics sells one garment: a long-sleeve shirt in 50% merino wool,
50% modal, in two fits (classic, crop) and seven sizes (XXS–XXL). The site is
a pre-drop announcement plus CASL-compliant email capture today, and the buy
flow (fit × size → Shopify cart → Shopify hosted checkout) once commerce is
switched on. First drop fall 2026. Success before launch is confirmed
subscribers; after launch it is completed orders.

## Positioning

"Vêtements de sport, sans le plastique." Athletic wear without the plastic: a
natural-fibre performance layer from a Quebec brand, sold as a single
considered product in drops rather than a catalogue.

## Operating Context

- French is the default locale at `/`, English at `/en/` (Charter of the
  French Language). Every page exists in both.
- Pre-drop, the home page shows no photography and no price: the garment
  isn't final. Founder preview (a signed cookie) is the only render with the
  real buy flow and photos in it.
- Price and availability come only from Shopify's Storefront API; there is no
  price in this repo. Checkout leaves the site for Shopify's hosted page.
- Commercial email (Resend) and Shopify's own notifications and packing slip
  are part of the brand surface, generated from this repo.

## Capabilities and Constraints

- Email signup with express, never pre-checked consent and double opt-in
  (CASL). Every commercial email carries sender name, mailing address and an
  unsubscribe link.
- Cart and checkout handoff through a provider-neutral commerce seam; Shopify
  is the authority for price, stock and purchase limits.
- Quebec CPA pre-contract disclosure is its own page, linked under the buy
  button; availability and "a cart is not a hold" are stated in plain text.
- "Made in China" is rendered as a compliance fact, never softened.
- Default to zero client JS; React islands only where interaction needs it.
  Every form degrades to a working native POST.
- Undecided: shipping rates (#64), final garment design and photography,
  exact drop date.

## Brand Commitments

- Name: Nuage Athletics ("nuage" is French for cloud). The logo is a rounded
  geometric lowercase wordmark (`src/components/Logo.astro`).
- Voice: short, plain, factual; French first. No hype, no claims the brand
  can't honour.
- The cloud sky (WebGL, with a drawn static fallback) is the brand's
  atmosphere on every page.

## Evidence on Hand

- Product copy, fibre content, fits and sizes: `src/lib/catalogue.ts`.
- Product photography exists (`public/img/ls-01-*`) but is preview-only until
  the garment is final.
- No testimonials, press, reviews, athlete endorsements or performance
  benchmarks exist. Do not invent them.

## Product Principles

1. Say only what can be honoured: a price, a stock level or a delivery promise
   comes from the system that enforces it, or it isn't shown.
2. French is never the lesser version.
3. One product, shown plainly: restraint over catalogue noise.
4. It works without JavaScript, without motion and without WebGL.

## Accessibility & Inclusion

WCAG AA contrast on every text token, checked by axe across all routes in CI.
Reduced motion, reduced transparency, increased contrast and forced-colors
each get a deliberate rendering, not a degraded one. Keyboard focus is always
visible.
