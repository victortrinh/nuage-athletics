# Shopify customer notification templates

Custom Liquid for every customer-facing Shopify notification this drop
needs (#91). **Generated** from `shopify/src/` by
`npm run shopify:notifications` — never hand-edit a `.liquid` file in this
directory, edit the source under `shopify/src/` and regenerate. `npm run
check` runs `shopify-notifications.ts --check` and fails if a committed
file is stale or fails its lint pass (no radii, no `var()`, no `shop.url`,
footer identification present, `{% if en %}` always paired with
`{% else %}`, unsubscribe only on abandoned-checkout).

There is no Shopify API for notification template content — every file
here has to be pasted by hand into **Settings → Notifications** in the
Shopify admin (part of #93's checklist). This file is that runbook.

## Why generated, not hand-written

Shopify notification templates can't `{% render %}` a shared snippet
between them, and each is pasted as a standalone blob — so the branded
shell (always-dark palette, wordmark, sky backdrop, footer) would otherwise
be copy-pasted eight times and drift the first time one copy got a fix the
others didn't. `shopify/src/shell.ts` + `blocks.ts` are that shared
partial, written once in TypeScript and reused by every
`shopify/src/templates/*.ts`; `t(fr, en)` is the Liquid analogue of
`src/i18n/ui.ts`'s exhaustive `Dict` — every user-facing string is written
in both languages at the same call site, with no way to construct one
branch without the other.

## Locale

Shopify doesn't pass this repo's own `Locale` type — it resolves the
checkout/customer's language at send time, inside Liquid, from whichever
of `order.customer_locale` / `checkout.customer_locale` / `customer.locale`
exists on that notification's payload (the exact name differs per
notification family and isn't consistently documented by Shopify). Every
template's locale prelude (`shopify/src/liquid.ts`'s `LOCALE_PRELUDE`)
tries all three, in that order, and **falls back to French** — matching
non-negotiable #1 (French is the default locale everywhere else in this
codebase) — rather than falling back to English on an unrecognised value.

The email body carries an HTML comment, `<!-- na-locale: … -->`, right
after `<!doctype html>`. **"Send test" always renders in the store's
default locale** (French), so it will always say `na-locale: fr` — that's
expected, not a bug. To confirm the EN branch actually fires, use a real
order/checkout placed in English (dev-store test order, #93's own
acceptance) and view-source the received mail.

## Before pasting a template

Shopify's own "Notifications variables reference" doesn't fully document
every field these templates use (fulfillment tracking fields, refund line
items, the abandoned-checkout `url`) — the *stock* template Shopify already
has loaded for that notification is the only reliable ground truth for
what's actually available. For each template below:

1. Open **Settings → Notifications → Customer notifications → <name> →
   Edit code**.
2. Skim the stock Liquid Shopify has there. Confirm every `{{ }}`/`{% %}`
   reference our version uses (see the per-template notes below) actually
   appears in it. If a field is missing or spelled differently, fix the
   source in `shopify/src/templates/<file>.ts` and regenerate — don't
   patch the pasted copy directly.
3. Replace the **body** with `<file>.liquid` and the **subject line**
   with `<file>.subject.liquid`. Save.
4. **Send test.** Check: the wordmark loads, the sky backdrop appears
   (Shopify's test send may block/cache images differently than a real
   inbox), the CTA button still reads ink-on-paper in Outlook.com or the
   Outlook mobile app (its auto-invert defense — see `EMAIL_THEME`'s doc
   comment in `src/lib/email.ts`), and `view-source` shows the
   `na-locale` comment.

## Store address

The footer prints Shopify's own `{{ shop.address.summary }}` — not a
constant in this repo. `src/lib/consent.ts`'s `SENDER_IDENTITY` has no
address for exactly the same reason ADR-0007 gives: this repo is public,
and a home address committed to it is in git history forever. **Settings →
Store details → Address** must be set to the same address as the
`SENDER_ADDRESS` Worker secret (`npx wrangler secret list` confirms it's
set; the value itself is only visible to whoever set it, or on
`/informations-precontractuelles/` once rendered) — #93's own checklist
item. If the two ever disagree, a buyer sees a different address on the
order they placed than on the page they placed it from.

## Templates

| File | Admin notification | Locale source | Notes |
|---|---|---|---|
| `order-confirmation` | Order confirmation | `order.customer_locale` | Line items, totals, both addresses, links to `/livraison/` and `/retours/`. |
| `shipping-confirmation` | Shipping confirmation | `order.customer_locale` | `fulfillment.fulfillment_line_items` (each wraps the real item under `.line_item`), tracking block. |
| `shipping-update` | Shipping update | `order.customer_locale` | Fires on a carrier tracking-status change. Uses `fulfillment_event.message` — **verify this object's shape against the stock template**; Shopify's docs don't cover it in detail. |
| `shipment-out-for-delivery` | Out for delivery | `order.customer_locale` | Same `fulfillment` context as shipping-confirmation. |
| `shipment-delivered` | Delivered | `order.customer_locale` | Same `fulfillment` context. |
| `abandoned-checkout` | Abandoned checkout | `checkout.customer_locale` | **The only template with an unsubscribe link** (`unsubscribe_url`) — this is Shopify's one marketing notification in scope (#93's amendment: CASL implied-consent-via-inquiry covers it). Reuses `cartNoHold` verbatim from `src/i18n/ui.ts` so the site and the email say the same thing about holds. |
| `order-cancelled` | Order cancelled | `order.customer_locale` | No cancellation reason shown (Shopify's `cancel_reason` is a code, not customer-facing wording). |
| `order-refund` | Order refund | `order.customer_locale` | Uses `refund_line_items` / `amount` — **verify against the stock template**; naming here varies by Shopify API version. |

## End-to-end verification (part of #93's own acceptance)

- One French and one English test order on the dev store, through to
  fulfilment with a real tracking number, so both locale branches and the
  tracking block get exercised for real.
- Cancel one order, refund one order, abandon one checkout (recovery
  fires after the delay set in Settings → Checkout, ~10h default).
- Confirm every received email's footer shows the same address as the
  site's own pages, and that the abandoned-checkout email's unsubscribe
  link actually opts the address out.

## Cross-references

- Store address, abandoned-checkout toggle, sender DKIM: **#93**.
- Refund/Shipping/Privacy/Terms/Contact policy slots (a different surface —
  Shopify's own policy pages, not these notifications): **#66**.
- `ADR-0007`: why the address is a secret, not a constant.
