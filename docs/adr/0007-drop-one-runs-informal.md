# 0007 — Drop one runs informal

## Status

Accepted (2026-09-15). **Amended 2026-09-15**, same day: Decision 2
(Address) reversed — see the amendment note below Decision 2 and the
updated Decision 3/4/5. **Amended again 2026-09-15**, same day: Decision 6
(Returns) narrowed — the no-returns *policy* stands, but "no dedicated
returns/shipping pages" is reversed. See the amendment note below Decision
6. Everything else in this ADR is unchanged.

## Context

ADR-0001 recommended incorporating at the REQ, on the reasoning that four
people selling a physical product to consumers is exactly the exposure
limited liability is for. ADR-0003 recommended a commercial mailbox as the
one address that clears CASL, the CPA, Law 25, and the REQ registration at
once. Both were **Proposed** / **Accepted-but-blocked** — nothing had
actually happened, and #44 tracked the work of making them happen.

Victor decided otherwise for drop one specifically:

- No incorporation and no REQ registration.
- ~~No alternate mailing address of any kind — not a commercial mailbox,
  not a PO box. Home stays off every public surface.~~ **Amended
  2026-09-15, same day:** home address may be public — see Decision 2.
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
2. ~~**Address.** No alternate address exists. `SENDER_IDENTITY.address`
   stays unset; `senderAddressConfigured()` (#46) gates every render site
   so the placeholder string never ships on a live page, and the address
   line is simply absent rather than shown as missing.~~

   **Amended 2026-09-15, same day: home address is public.** Victor
   reversed this specific call the day it was recorded — his home address
   may appear on the legal pages, in email footers, and in Shopify's own
   notification footers. It is **not** committed to `src/lib/consent.ts`
   as a constant, because this repo is public and a constant would put a
   home address in git history permanently. Instead it is the
   `SENDER_ADDRESS` Worker secret (`wrangler secret put`), read via
   `env.SENDER_ADDRESS` in the Worker and `process.env.SENDER_ADDRESS` in
   scripts. `senderAddressConfigured()` (#46) now gates on the secret
   being set, not on the placeholder being replaced — same mechanism,
   inverted intent: it still means "never render a placeholder," but the
   expected end state is the line rendering, not being omitted.
   `Seo.astro`'s Organization JSON-LD still deliberately omits `address` —
   that omission is no longer "it's a placeholder," it's "a home address
   is not something to hand every aggregator just because it's readable
   on a policy page."
3. **Phone.** Not published. CPA s. 54.4 (c) [phone] is knowingly
   incomplete on the pre-contract disclosure (#92) — (b) [address] is now
   satisfied by the amendment above. Section 54.8 gives a buyer a 7-day
   cancellation right when 54.4 is incomplete — accepted as the cost of
   the phone gap alone, narrower than the address+phone exposure this ADR
   originally accepted.
4. **Mailing list.** ~~Stays off.~~ **Amended: comes back on once #67
   lands.** `SIGNUP_PROMPT_ENABLED` returns to `true` once `SENDER_ADDRESS`
   is set and #67's e2e un-skip lands — the reason it was `false` (no
   CASL-compliant address for the confirmation footer) no longer applies.
   The drop is announced on social *and* by email once this ships.
5. **Shipping label / packing slip.** Home address is the Shopify ship-from
   location and prints as the return address, as before — now alongside
   being the address on every other surface, not the one exception to
   "never published."
6. ~~**Returns.** No policy beyond contacting `hello@` — see #92 and #66 for
   the exact wording. #47's dedicated `/retours/` and `/livraison/` pages
   are deferred; the pre-contract page (#92) carries the whole disclosure
   for drop one.~~

   **Amended 2026-09-15, same day: #47 is built, not deferred.** The
   no-returns policy itself is unchanged — still "no returns or exchanges
   for this first release, email hello@, the legal warranty applies," now
   on `retours.astro` / `en/returns.astro` verbatim from the pre-contract
   page. What reversed is only "no dedicated pages": a policy readable
   solely inside Shopify's checkout settings isn't something a buyer can
   retain before the contract forms (the LPC requirement #47 exists for),
   and Shopify auto-links its Refund/Shipping policy slots in the hosted
   checkout footer regardless (#66) — those slots now point at real pages
   on this domain instead of a Shopify default or nothing. `livraison.astro`
   / `en/shipping.astro` carry the same delivery terms already on the
   pre-contract page (Canada only, Canada Post, 30-day delivery-delay
   termination right) with no shipping rate, since #64 hasn't set one.
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
  to point here. ADR-0003's address half is now **resolved differently**
  rather than deferred (see its own amendment); only its dealer-ID half
  remains deferred.
- ~~#67 (mailing address + phone)~~ **Amended: #67 (now address + list
  reactivation only) is back in drop one's scope, not deferred.** The
  incorporation half of #44 and the CA-number half of ADR-0003 stay in the
  `Post-drop-one` milestone. The phone gap is a single bullet in #44, not
  its own issue. **#47 (returns/shipping pages) is also back in drop one's
  scope**, not deferred — see Decision 6's amendment.
- #46 is rescoped, not widened the way originally planned: instead of
  gating the address line *off* every render site because there's no
  address, `senderAddressConfigured()` now gates it *on* — present when
  `SENDER_ADDRESS` is set, omitted (never a placeholder) when it isn't.
  Same six render sites: `confidentialite.astro`, `en/privacy.astro`,
  `conditions.astro`, `en/terms.astro`,
  `informations-precontractuelles.astro`, and
  `en/pre-contract-information.astro`.
- `CONTEXT.md`'s "What blocks each flag" section notes `SENDER_ADDRESS`
  as a gate on `COMMERCE_ENABLED` (the pre-contract page's 54.4 (b) line
  reads from it) — the entity and CA-number gates still drop, pointing
  here.
- This is a drop-one-sized bet, not a standing policy. Revisit before drop
  two — the exposures accepted here (CPA disclosure gap under s. 54.8 for
  the phone alone, no registered entity, no textile dealer ID) get harder
  to justify as volume grows.

Not legal or accounting advice. Tracked in #44 (the rewritten checklist)
and #67 and #47 (both back in drop one's scope).
