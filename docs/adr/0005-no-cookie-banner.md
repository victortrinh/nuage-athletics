# 0005 — No cookie consent banner

## Status

Accepted.

## Context

[#39](https://github.com/victortrinh/nuage-athletics/issues/39) asked whether
the site needs a cookie consent banner. Quebec's Law 25 (and PIPEDA
generally) requires consent for collecting personal information, and requires
it to be meaningful and specific — but it does not impose the EU/UK-style
"cookie banner" mechanism as a legal form. A banner is the right answer when a
site sets non-essential tracking cookies (analytics, ad pixels, third-party
trackers) that identify or profile a visitor.

This site does not do that:

- No analytics platform is wired in (no GA4, no Meta Pixel, no equivalent).
- The cookies this site does set are all strictly necessary for the feature
  they support and carry no cross-session profiling purpose: the founder
  preview cookie (`src/lib/preview.ts`), the CASL double-opt-in session
  state, and the Shopify cart id.
- `localStorage`/session-scoped UI state (if any) is not personal information
  under Law 25 in the way a tracking identifier would be.

A banner over a site with nothing to consent to would be worse than no
banner: it implies a tracking practice that doesn't exist, and it's one more
piece of UI competing with the zero-JS-by-default, no-radii design the rest
of the site holds to.

## Decision

**No cookie consent banner.** Strictly-necessary cookies (preview, opt-in
session, cart) are set without a banner, as Law 25 permits. If any future
feature introduces a non-essential cookie — analytics (GA4 is the concrete
example that prompted this ADR), advertising pixels, third-party embeds with
their own tracking — that feature must not ship without first reopening this
decision, since the premise (nothing to consent to) would no longer hold.

## Consequences

- No "cookies" page/route exists in the inventory (ADR-0006) — there is
  nothing to disclose.
- Adding GA4, or any other tracking script, is not "just adding a script tag"
  — it obligates a cookie banner and a cookies page, and should trigger a
  read of this ADR before the change is made, not after.
