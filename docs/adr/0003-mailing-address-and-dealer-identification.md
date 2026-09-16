# 0003 — Mailing address and dealer identification

## Status

**Split (amended 2026-09-15, same day as ADR-0007).** The address half is
**resolved differently for drop one**, not deferred: Victor's home address
may be public, stored as the `SENDER_ADDRESS` Worker secret rather than a
commercial mailbox — see ADR-0007's amended Decision 2 and #46/#67. The
"one commercial mailbox satisfies everything" recommendation below is moot
for drop one; it remains the target only if the home address ever needs to
come down from public view, and a secret is exactly what makes that a
one-step rotation instead of a repo-wide find-and-replace.

The **dealer-identification (CA number) half stays deferred to
post-drop-one** — tracked in #44's textile-labelling line, in the
`Post-drop-one` milestone. Nothing about the CA-number decision changed.

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

**Address half — superseded for drop one, 2026-09-15.** Rather than a
commercial mailbox, drop one uses Victor's home address, stored as the
`SENDER_ADDRESS` Worker secret (not the `SENDER_IDENTITY.address` constant
this ADR originally proposed — see ADR-0007's amended Decision 2 and #46).
The reasoning below for *why one address covers four requirements* still
holds; only *which* address, and *how it's stored*, changed.

- ~~Obtain a commercial mailbox before any commercial email is sent or
  `COMMERCE_ENABLED` flips to `"true"`. Set `SENDER_IDENTITY.address` to
  the real value once it exists — this is the only edit needed; all six
  render sites read from that one constant.~~ Superseded: set
  `SENDER_ADDRESS` via `wrangler secret put` instead (#46, #67) — a secret
  rather than a constant because this repo is public and a committed
  address is permanent in its history.
- Obtain a CA number from the Competition Bureau (free) for garment labels,
  rather than printing a full dealer address on the physical label. **Still
  deferred** — unaffected by the address amendment.
- The CA-number half is treated as a launch blocker for the **physical
  product** only: it should not ship without the CA number or equivalent
  dealer address on its label. The address half is no longer a
  `COMMERCE_ENABLED` blocker in the same binary sense — see #46/#67's
  acceptance criteria for what actually gates it now.

## Consequences

- The address is no longer a single constant edit — `senderAddressConfigured()`
  (#46) reads `env.SENDER_ADDRESS`/`process.env.SENDER_ADDRESS` at every
  render site instead of one module-level value, precisely so the address
  is never committed to the repo.
- `SIGNUP_PROMPT_ENABLED` in `src/i18n/utils.ts` returns to `true` once
  `SENDER_ADDRESS` is set (#67) — no longer stays `false` pending an
  address decision, since one now exists.
- Tracked in [#44](https://github.com/victortrinh/nuage-athletics/issues/44),
  [#46](https://github.com/victortrinh/nuage-athletics/issues/46), and
  [#67](https://github.com/victortrinh/nuage-athletics/issues/67).
