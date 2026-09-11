# 0003 — Mailing address and dealer identification

## Status

Accepted (as a requirement); **blocked** pending the actual address and CA
number.

## Context

Two pieces of real-world identity are missing, and both are launch blockers
rather than paperwork that can trail behind the code:

1. **A mailing address.** CASL requires sender identification and a physical
   mailing address in every commercial email, with no small-business
   exemption. Quebec's *Loi sur la protection du consommateur* (LPC) requires
   merchant identification before a distance contract is formed, also with no
   exemption. `SENDER_IDENTITY.address` (`src/lib/consent.ts:19`) is currently
   the literal string `[ADRESSE POSTALE REQUISE / MAILING ADDRESS REQUIRED]`,
   and it renders live in six places:
   - `src/lib/email.ts` (every outbound email's footer)
   - `src/pages/confidentialite.astro` / `src/pages/en/privacy.astro`
   - `src/pages/conditions.astro` / `src/pages/en/terms.astro`
   - `src/pages/informations-precontractuelles.astro` /
     `src/pages/en/pre-contract-information.astro` (the "Commerçant" field)

2. **Dealer identification for textile labelling.** The Textile Labelling Act
   requires each garment to carry fibre content in both official languages
   plus dealer identification — either the full name and postal address of
   the Canadian dealer, or a **CA number** issued free by the Competition
   Bureau. The product is designed in Quebec and made in China
   (`src/lib/catalogue.ts` states this on the product page as a compliance
   fact, not marketing copy — see commit `57c7fa5`, "stop claiming Made in
   Canada"), so this applies at the border and at point of sale. This is a
   physical-garment requirement this repo cannot render or verify; it is
   recorded here so it isn't silently forgotten because no code path depends
   on it.

A single commercial mailbox (~$15–25/month) satisfies the CASL footer, the
LPC merchant identification, the privacy-policy contact, and (once ADR-0001's
registration lands) the REQ registered address — one line item, four
requirements. Per
`docs/superpowers/plans/2026-08-07-confirmation-email-not-delivered.md`, it
must be an address that actually receives physical mail for at least 60 days
after the last send, since CASL messages have to remain answerable for that
long.

## Decision

- Obtain a commercial mailbox before any commercial email is sent or
  `COMMERCE_ENABLED` flips to `"true"`. Set `SENDER_IDENTITY.address` to the
  real value once it exists — this is the only edit needed; all six render
  sites read from that one constant.
- Obtain a CA number from the Competition Bureau (free) for garment labels,
  rather than printing a full dealer address on the physical label.
- Both are treated as **launch blockers**, not follow-up tasks: `COMMERCE_ENABLED`
  should not go to `"true"` while `SENDER_IDENTITY.address` is still the
  placeholder, and the physical product should not ship without the CA
  number or equivalent dealer address on its label.

## Consequences

- No code change is required to *implement* this decision — `consent.ts`
  already centralizes the address into one constant precisely so that this
  is a one-line fix once the real value exists.
- Until it lands, `SIGNUP_PROMPT_ENABLED` in `src/i18n/utils.ts` stays `false`
  for the same reason: collecting an address the confirmation email can't
  legally reach is worse than not asking yet
  ([#67](https://github.com/victortrinh/nuage-athletics/issues/67)).
- Tracked in [#44](https://github.com/victortrinh/nuage-athletics/issues/44).
