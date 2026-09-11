# 0001 — Legal structure and ownership

## Status

**Proposed** — awaiting confirmation from all four founders. Nothing here is
implemented; no entity is registered as of this writing.

## Context

Four people are building Nuage Athletics together with no written agreement.
Under the *Code civil du Québec* (art. 2186 ff.), four people carrying on a
business in common with a view to profit already form a *société en nom
collectif* (SENC) by default, whether or not anyone intended that — it carries
**joint and several** personal liability, meaning any one partner can be
pursued for the whole of the venture's debts. Staying informal does not avoid
this partnership; it produces one with no written terms.

Separately, any business operating under a name that is not the owner's own
name must register with the Registraire des entreprises (REQ) — "Nuage
Athletics" triggers this regardless of which structure is chosen.

The larger risk is not the CRA. It is that ownership of the wordmark, the
domain, this repository, and the Shopify/Cloudflare/Resend/Zoho accounts is
currently ambiguous across four people — and drop one selling out is exactly
when that ambiguity becomes a dispute.

The repo already depends on this being resolved: `SENDER_IDENTITY.address`
(`src/lib/consent.ts`) is a literal placeholder that renders in six places
(email footers, privacy/terms pages, the precontract-disclosure page), and the
merchant-identity block on the terms and precontract pages needs a real legal
name and (once registered) an NEQ.

## Decision

- **Incorporate provincially at the REQ** (~$400), shares split four ways.
  Selling a physical product manufactured by a third party, imported
  commercially, to consumers is exactly the exposure limited liability is for
  — with four partners, removing the joint-and-several exposure by
  incorporating is the point, not a nicety.
  - Fallback, if the founders prefer to stay unincorporated: an SENC **with a
    written partnership agreement** — the agreement is not optional either
    way.
- Obtain a CRA Business Number regardless of structure — needed for the
  import/export (RM) program account to be importer of record on the
  commercial shipment from China.
- Written agreement, before drop one, covering: who owns the wordmark, the
  domain, and each of the Shopify / Cloudflare / Resend / Zoho accounts; and
  the revenue split.
- Move every third-party account onto the brand identity
  (`hello@nuageathletics.com`) rather than a founder's personal account, so
  the business survives any one founder leaving.

## Consequences

- `SENDER_IDENTITY.address`, the terms page's merchant-identity block, and the
  precontract-disclosure page's "Commerçant" section all stay placeholder text
  until this resolves — they are launch blockers, not paperwork to do later
  (see ADR-0003 and CONTEXT.md's gate list).
- `COMMERCE_ENABLED` cannot flip to `"true"` in good conscience before this
  is at least in motion — a live storefront selling under an unregistered,
  undocumented four-way arrangement is the exact ambiguity this ADR exists to
  close.
- Tracked as the entity/ownership half of the checklist in
  [#44](https://github.com/victortrinh/nuage-athletics/issues/44); nothing
  here is a code change.
