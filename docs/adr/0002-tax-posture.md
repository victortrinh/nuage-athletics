# 0002 — Tax posture for drop one

## Status

Accepted.

## Context

A small supplier — under **$30,000 in gross taxable revenue over four
consecutive calendar quarters** — is not required to register for or collect
GST, and QST mirrors that threshold. Not charging tax below it is the rule,
not an evasion of it, and it is already the biggest reason a first drop can
run informally.

Two things make this a decision rather than a default that can be left
unstated:

- The threshold is **per entity, not per person**. Four founders do not get
  four times the headroom; one entity, one $30,000 ceiling.
- The threshold is measured over a **trailing four-calendar-quarter window**,
  so it can be crossed **mid-drop**, not just year over year — and tax becomes
  owed starting from the transaction that crosses it, not retroactively on
  everything before it and not only from the next quarter.
- Registering means charging tax (a real price increase, or absorbed out of
  margin), filing returns, and configuring Shopify tax collection — but it
  also means recovering GST paid at the border on the China import and QST
  paid on Shopify/Resend/Cloudflare fees. On a 200-unit import that input tax
  is real money, which is why this is a trade to revisit with an accountant,
  not a permanent default.

This was previously recorded in [#30](https://github.com/victortrinh/nuage-athletics/issues/30)
as "left off in Shopify settings for now" — a silent default with no trigger
attached, which is the gap this ADR closes.

> Not legal or accounting advice. Confirm with a Quebec accountant before
> drop one, and again if the threshold is approached.

## Decision

- **Do not register for GST/QST for drop one.** Leave tax collection off in
  Shopify settings — a settings toggle, not a code path, if/when it changes.
- **The trigger**: revenue crossing $30,000 in gross taxable sales over the
  trailing four calendar quarters. This is a running total to watch during
  the drop, not a once-a-year check.
- **Who watches it**: whoever holds the Shopify admin (currently informal;
  becomes explicit once ADR-0001 resolves who holds which account) checks
  cumulative revenue against the threshold at least monthly during an active
  drop, and immediately after any single large order that could plausibly
  cross it alone.
- Crossing the threshold means registering and enabling tax collection in
  Shopify **starting from the transaction that crosses it** — not backdated,
  not deferred to the next quarter.

## Consequences

- No code change: this is purely a Shopify settings state plus a manual
  monitoring habit.
- Landed cost (duty + freight + the *unregistered* input-tax position) has to
  be computed with this decision in mind — see ADR-0001's note that
  `catalogue.ts` cannot carry a price until landed cost is known, and
  non-negotiable 5.5's rule that Shopify is the only source of a
  customer-visible price.
- If the threshold is ever crossed, update this ADR's Status to
  **Superseded** and open a new one recording the registration date and the
  Shopify tax configuration actually enabled, rather than editing this one in
  place — the trigger and the decision it triggered are both worth keeping on
  the record.
