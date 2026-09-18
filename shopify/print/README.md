# Shopify print documents

Custom Liquid for everything Shopify prints on paper for this drop (#110).
**Generated** from `shopify/src/print/` by `npm run shopify:print` — never
hand-edit a `.liquid` file in this directory, edit the source and regenerate.
`npm run check` runs `shopify-print.ts --check` and fails if a committed file
is stale or fails its lint pass.

Same contract as `shopify/notifications/`, a different medium. Read that
directory's README first if you haven't — the locale handling, the store
address and the "verify against the stock template" discipline are identical
and aren't repeated here.

## What's in here

| File | Admin location | Notes |
|---|---|---|
| `packing-slip` | Settings → Shipping and delivery → Packing slips → Edit template | The one branded thing that physically goes in the box. |

## What is *not* in here, and won't be

**Shipping labels are not a branding surface.** The artwork on a Canada Post
label comes from Canada Post; Shopify renders what the carrier's API returns.
There is no template, no logo slot, no colour and no type to set. The only
things that are yours to choose are the return address (= the store address,
#93), the label format (4×6 thermal vs 8.5×11 — #63's printer), and whether a
packing slip prints alongside it. Written down here because "brand the
shipping labels" sounds like a setting someone hasn't found yet, and it isn't
one. See #109.

Physical inserts — a thank-you card, a sticker, a branded mailer — *are* real
print branding, but they're a print-vendor job with no Shopify surface and no
template. Not this directory.

## How the print medium differs from the email one

Every one of these is a deliberate inversion of something
`shopify/src/shell.ts` does, and each is enforced by `shopify-print.ts`'s lint
so it can't quietly drift back:

- **Ink on paper, not the always-dark email palette.** `EMAIL_THEME` is dark
  because mail clients auto-invert light backgrounds; paper has no inverter.
  `PRINT_THEME` is the site's own light palette. The lint rejects any
  `EMAIL_THEME` hex appearing in a print document — that's the rule that
  catches a block pasted across from the email side.
- **No page background at all.** `PRINT_THEME.paper` is pure white and nothing
  sets it: the ground is the sheet. Painting it means laying toner over every
  square inch of every order.
- **A `<style>` block, not inlined declarations.** There's a real CSS engine
  here, and `@page` (the sheet margin) and `page-break-inside` can't be
  inlined at all.
- **No unsubscribe, no CTA button.** Nothing on paper is clickable and paper
  has no unsubscribe mechanism. Both are lint failures, not judgement calls.
- **Its own wordmark asset.** `public/img/wordmark-print.png`
  (`npm run print:wordmark`) is dark lettering on a *transparent* ground at
  960px — ~575 dpi on the page. The email asset is light-on-dark at 320px and
  would print as a black box at ~190 dpi.

## Before pasting the packing slip

Shopify documents the packing slip's Liquid variables even less thoroughly
than the notification ones, so the stock template loaded in the admin is the
ground truth. Same three-step discipline as the notifications:

1. Open **Settings → Shipping and delivery → Packing slips → Edit template**.
2. Skim the stock Liquid. Confirm each reference our version uses actually
   appears in it:
   - `line_items` at the **top level** (the items in *this shipment*, not
     `order.line_items`), each with `.title`, `.variant_title`, `.sku`,
     `.quantity`
   - `order.name`, `order.created_at`, `order.email`, `order.note`
   - `order.shipping_address` piped through `format_address`
   - `order.customer_locale` (the locale prelude's first choice)
   - `shop.address.summary`
   If a field is missing or spelled differently, fix
   `shopify/src/print/packing-slip.ts` and regenerate — don't patch the pasted
   copy.
3. Replace the template with `packing-slip.liquid` and save.

## Verifying it

`npm run shopify:print -- --preview` renders both locales into
`tmp/shopify-print/` with fixture data. **Actually print one** — or
Print-to-PDF — rather than only looking at it on screen. Three things only
show up on paper:

- The wordmark is sharp, not soft or pixelated (if it is soft, the asset
  didn't load and you're looking at alt text).
- No grey box behind the mark or the page (that would mean a ground got
  painted somewhere).
- A two-page order doesn't split a line item across the break.

Then, in the admin, on a real test order:

- [ ] Print a slip for a French order and an English one — the locale comes
      from `order.customer_locale`, so both branches need a real order to be
      exercised (the same caveat the notifications README gives about "Send
      test" always rendering in the store's default locale).
- [ ] The wordmark loads. It's fetched from `nuageathletics.com`, so it only
      works once this branch is deployed — a slip printed before deploy will
      show alt text instead. That's the asset, not the template.
- [ ] The footer address matches the site's own pages (#93's checklist item —
      it's `{{ shop.address.summary }}`, from Settings → Store details).
- [ ] The SKU on the slip matches the variant that was actually ordered.

### One open question

The mark is a raster because this file is pasted into an admin field whose
sanitiser this repo can't test against, and a mark that silently fails to
render is worse than one that's merely 575 dpi. If an inline `<svg>` turns out
to survive the paste, it would be sharper still and need no hosted asset —
worth trying once, and recording the answer here either way.

## Cross-references

- Notification templates, locale handling, store address: `shopify/notifications/README.md`
- Store address, ship-from location, label format: #93
- Shipping labels and the label printer: #109, #63
- Why the home address is acceptable on a slip but published nowhere: ADR-0007
- The full inventory of Shopify branding surfaces: #110
