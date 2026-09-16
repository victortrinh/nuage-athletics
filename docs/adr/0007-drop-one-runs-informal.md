# 0007 — Drop one runs informal

## Status

Accepted (2026-09-15).

## Context

ADR-0001 recommended incorporating at the REQ, on the reasoning that four
people selling a physical product to consumers is exactly the exposure
limited liability is for. ADR-0003 recommended a commercial mailbox as the
one address that clears CASL, the CPA, Law 25, and the REQ registration at
once. Both were **Proposed** / **Accepted-but-blocked** — nothing had
actually happened, and #44 tracked the work of making them happen.

Victor decided otherwise for drop one specifically:

- No incorporation and no REQ registration.
- No alternate mailing address of any kind — not a commercial mailbox, not
  a PO box. Home stays off every public surface.
- No phone number.
- Home address is acceptable on shipping labels and packing slips (the
  Shopify ship-from location), since a label reaches one buyer at a time
  and is never published.
- No return policy beyond "email us" — no dedicated returns/shipping pages
  for drop one.
- No textile dealer identification (no CA number, no printed dealer
  address on the garment label).

This is a narrower posture than either earlier ADR assumed, and it trades
real legal exposure for privacy and speed. It is written down here, rather
than left to accumulate as silent gaps, because CLAUDE.md's own non-negotiable
#4 principle — that a compliance decision needs a record of what was
actually decided, not just what the code enforces — applies to a decision
*not* to build something as much as to one that changes wording.

## Decision

For drop one only:

1. **Entity.** Victor operates as an individual. No REQ registration for
   "Nuage Athletics" as a business name. Every legal-page merchant block
   reads "Nuage Athletics" + `hello@nuageathletics.com`, nothing else.
2. **Address.** No alternate address exists. `SENDER_IDENTITY.address`
   stays unset; `senderAddressConfigured()` (#46) gates every render site
   so the placeholder string never ships on a live page, and the address
   line is simply absent rather than shown as missing.
3. **Phone.** Not published. CPA s. 54.4 (b) [address] and (c) [phone] are
   both knowingly incomplete on the pre-contract disclosure (#92). Section
   54.8 gives a buyer a 7-day cancellation right when 54.4 is incomplete —
   accepted as the cost of this decision.
4. **Mailing list.** Stays off. `SIGNUP_PROMPT_ENABLED` remains `false` —
   not because sending is broken (Resend's DNS is fully configured), but
   because there is no CASL-compliant address for the footer. The drop is
   announced on social channels instead.
5. **Shipping label / packing slip.** Home address is the Shopify ship-from
   location and prints as the return address. Accepted: this is the one
   surface where the address reaches someone who has already given us
   theirs, individually, not published.
6. **Returns.** No policy beyond contacting `hello@` — see #92 and #66 for
   the exact wording. #47's dedicated `/retours/` and `/livraison/` pages
   are deferred; the pre-contract page (#92) carries the whole disclosure
   for drop one.
7. **Textile labelling.** No CA number obtained, no dealer address printed
   on the garment. The Textile Labelling Act's dealer-identification
   requirement is knowingly not met.
8. **Tax.** Unchanged from ADR-0002 — no GST/QST registration, no tax
   charged. That decision was never in question here; it's restated for
   completeness since "tax evade" was the framing this ADR's grilling
   session started from, and it isn't evasion: staying under the
   small-supplier threshold is the rule the CRA and Revenu Québec set,
   not a workaround of it.

## Consequences

- ADR-0001 and ADR-0003 are **deferred**, not superseded in the sense of
  being wrong — their recommendations still apply whenever the business
  grows past a one-person, one-drop operation. Their statuses are updated
  to point here.
- #67 (mailing address + phone), #47 (returns/shipping pages), the
  incorporation half of #44, and the CA-number half of ADR-0003 move to a
  `Post-drop-one` milestone.
- #46 is widened: `senderAddressConfigured()` now also gates the address
  line on `confidentialite.astro`, `en/privacy.astro`, `conditions.astro`,
  `en/terms.astro`, `informations-precontractuelles.astro`, and
  `en/pre-contract-information.astro` — reversing that issue's earlier
  decision to leave the placeholder rendering on those pages while they
  were drafts. Once #92 removes the draft banners and makes them
  indexable, a placeholder string on a live selling page is worse than an
  omitted line.
- `CONTEXT.md`'s "What blocks each flag" section drops the entity,
  address, and CA-number gates on `COMMERCE_ENABLED`, replacing them with
  a pointer here.
- This is a drop-one-sized bet, not a standing policy. Revisit before drop
  two — the exposures accepted here (CPA disclosure gaps under s. 54.8, no
  registered entity, no textile dealer ID) get harder to justify as volume
  grows.

Not legal or accounting advice. Tracked in #44 (the rewritten checklist),
#67, and #47 (both deferred).
