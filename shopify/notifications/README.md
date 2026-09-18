# Shopify customer notification templates

Custom Liquid for every customer-facing Shopify notification this drop
needs (#91, extended by #110). **Generated** from `shopify/src/` by
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
| `order-invoice` | Order invoice | `order.customer_locale` | For orders that never came through the site (keyed in by hand, replacements). **Verify `invoice_url`** — an unpaid order's pay link is not `order_status_url` and Shopify's reference doesn't pin its name down. Also check whether the admin lists a separate "Draft order invoice" slot; if so it needs its own template. |
| `order-edited` | Order edited | `order.customer_locale` | Prints the order's state *after* the edit, deliberately with no "what changed" delta — see the file's doc comment, and the open question below. |
| `contact-customer` | Contact customer | `customer.locale` | The template behind an order's "Contact customer" action. **Body only — there is no `contact-customer.subject.liquid`**, because the admin dialog has its own Subject field typed per message. Leave Shopify's stock subject template in place. |

## Notifications deliberately *not* generated

Shopify's customer-notification list is much longer than this directory. Each
omission below is a decision, so that a missing template reads as one rather
than as an oversight (#110's inventory):

| Not generated | Why |
|---|---|
| Return requested / approved / declined, return label instructions | Drop one has no returns — the policy is "email us" (ADR-0007). **See the operational note below.** |
| Customer account invite / activation / welcome / password reset | Customer accounts are off (#93). |
| Local order ready for pickup / picked up / local delivery | No pickup, no local delivery. Three templates if that ever changes. |
| Gift card created | Not selling gift cards. |
| POS and mobile receipt, exchange receipt, B2B company invites | No POS, no B2B. |
| Payment error, pending payment / payment reminder | Offline and retry payment methods only; Shopify Payments captures up front. Revisit if a manual payment method is ever enabled. |
| Fulfillment request / cancellation | Goes to a fulfillment service, not a customer. |

### Operational note: refund, don't "return"

A refund issued **from the order page** fires `order-refund`, which is
branded. A refund issued through Shopify's **returns flow** fires the return
notifications instead, which are not in this directory and will go out as
stock Shopify. For drop one, refund from the order page.

## Open questions

- **`order-edited`'s delta.** Shopify exposes the edit's added/removed lines
  to that template, but under names its own variable reference doesn't pin
  down and which have moved between API versions. The template prints the
  order's resulting state instead. If the stock template turns out to carry a
  reliable delta collection, adding a "what changed" block is a small change
  to `shopify/src/templates/order-edited.ts`.
- **`order-invoice`'s pay link.** `{{ invoice_url }}` is guarded, so a wrong
  name renders no button rather than a dead one — but an invoice with no way
  to pay it is still broken. This is the single most important field to check
  against the stock template.
- **A separate "Draft order invoice" slot.** If the admin lists one, it is its
  own notification with its own stock template, not `order-invoice` pasted
  twice.

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
- Printed documents (the packing slip) — a different medium with an inverted
  palette and its own lint: `shopify/print/README.md`.
- The full inventory of Shopify branding surfaces, including the ones that
  aren't code: **#110**.
- `ADR-0007`: why the address is a secret, not a constant.
