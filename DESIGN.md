---
name: Nuage Athletics
description: Ink on paper under a grey cloud deck, for one natural-fibre long sleeve.
colors:
  ink: "#0a0a0a"
  paper: "#fafafa"
  mute: "#63696e"
  line: "#dcdcdc"
  accent: "#4f7cff"
  accent-ink: "#3a5fd9"
  danger: "#b91c1c"
  warn: "#92400e"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  prose:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Helvetica Neue, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.18em"
  mono-label:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "0.18em"
  wordmark:
    fontFamily: "Futura, Century Gothic, Avenir Next, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 800
    letterSpacing: "-0.03em"
rounded:
  none: "0"
  full: "9999px"
spacing:
  gutter: "1.5rem"
  gutter-sm: "2.5rem"
  header-h: "4rem"
  container: "80rem"
  prose: "42rem"
components:
  button-solid:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "12px 24px"
    width: "100%"
  button-solid-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  button-text:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  input-underline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "8px 0"
  radio-size:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "44px"
  radio-size-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  radio-fit:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px"
  checkbox:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    size: "16px"
  link-footer:
    textColor: "{colors.mute}"
    typography: "{typography.prose}"
---

# Design System: Nuage Athletics

<!-- Recorded from the shipped site, not from intentions. The source of truth
     is src/styles/global.css (@theme) and src/components/ui/*-variants.ts;
     if this file and the code disagree, the code wins and this file is stale.
     CLAUDE.md's design rules are enforced by scripts/check-guards.sh and the
     e2e suite; this file describes them, it does not relax them. -->

## Overview

**Creative North Star: "The Overcast Ledger"**

A ruled page of ink on paper, held under a moving grey cloud deck. The sky is
the only atmosphere on the site: a WebGL overcast field behind everything,
greyscale, with clear sky as near-white and density reading darker. Everything
in front of it is flat and exact: hairline rules instead of cards, square
corners everywhere, small uppercase labels tracked wide, and one blue accent
held back for links and focus.

Density is low and deliberate. The pre-drop home page is three lines in one
`<h1>`, centred over the sky, and nothing else: what's dropping, what the
brand is, when. When commerce is on, the product body is a single column of
photograph, fit tabs, size row and one solid button. Type is small and the
page is mostly air; the scale contrast comes from the sky and the
photography, not from big headings.

The system is French-first and light-only. There is no dark mode on the
site; the only dark surface in the brand is commercial email, which is
always-dark on purpose (see Colors).

**Key Characteristics:**
- Ink/paper monochrome with a single blue accent.
- Hairlines (`line`) as the structural device; no cards, no shadows.
- Zero radii, with exactly two circular exceptions.
- 11px uppercase labels at 0.18em tracking as the system's voice.
- Hard 2px offset focus outline, never a soft ring.
- Motion is short, eased, and fully gated on `prefers-reduced-motion`.
- The cloud sky as the only texture, with a drawn static fallback.

## Colors

A greyscale ledger with one cold blue, every text pairing measured against
paper for AA.

### Primary
- **Ledger Ink** (ink): all body text, the solid button's fill, selected
  radio cells, the input underline, `::selection` background.

### Secondary
- **Overcast Blue** (accent): the bright accent, reserved for the sky glow.
  It is 3.57:1 on paper, so it never carries text.
- **Deep Overcast Blue** (accent-ink): the accent as it appears on the page.
  Link hover colour, the focus outline, the checkbox's hover edge, the cart
  confirmation ring. 5.35:1 on paper.

### Neutral
- **Paper** (paper): page ground, button text, unselected fit-tab fill.
- **Slate Mute** (mute): secondary text, field labels, the footer. A
  darkened sibling of the logo's brand grey (#9BA1A6), which is 2.3:1 on
  paper and so is used for the mark only, never words.
- **Hairline** (line): rules between regions, the drawer's edge, the gaps
  that draw the fit tabs' separators.

### Status
- **Signal Red** (danger): field errors and failed actions only. 6.2:1.
- **Weathered Amber** (warn): draft and stock-adjustment notices. Amber-800
  rather than amber-700, because small anti-aliased text measured below AA at
  the lighter value.

### Named Rules
**The One Accent Rule.** Blue is the only hue on the site. Everything that
isn't a link, a focus state or the sky is ink, paper or grey.

**The Measured Pair Rule.** A colour that carries words has a contrast ratio
written next to its declaration. A brand colour that fails AA gets a darkened
sibling for text (`mute` for the logo grey, `accent-ink` for `accent`); the
original stays on non-text uses.

**The Three Grounds Rule.** The same brand renders on three grounds, each with
its own palette, and they are not interchangeable: the site is ink on paper
(`global.css`); email is always-dark, light ink on #161616 with a lifted
accent #8fa8ff (`EMAIL_THEME`, `src/lib/email.ts`), because mail clients
auto-invert light mail; print is ink on unpainted white (`PRINT_THEME`,
`shopify/src/print/theme.ts`), because paper has no inverting client and a
dark sheet is just toner. The print lint fails on any `EMAIL_THEME` hex.

## Typography

**Body Font:** the system sans stack (`ui-sans-serif, system-ui,
-apple-system, "Helvetica Neue", Arial`). No webfont is shipped.
**Label/Mono Font:** Tailwind's default monospace stack, for product facts:
the product name, price, notices and the cart count.
**Display Font:** Futura, falling back through Century Gothic and Avenir Next
(`--font-display`, `.wordmark`). Reserved for the wordmark and email
headings; the site's own logo is an SVG, so on the page today the display
face is not rendered as live text.

**Character:** neutral system sans doing the reading, with tracked uppercase
and monospace doing the labelling. The voice is in the labels, not in display
type.

### Hierarchy
- **Headline** (600, 1.875rem, tracking -0.025em): legal and info page `h1`s.
- **Title** (600, 1.125rem): section `h2`s on those pages.
- **Body** (400, 1rem, 1.5): form inputs, the nav drawer's links.
- **Prose** (400, 0.875rem, 1.625): long-form legal text, capped at 42rem.
- **Label** (400, 11px, 0.18em, uppercase): field labels, the solid button,
  the signup prompt's eyebrow, secondary links under the buy button.
- **Mono label** (400, 0.75rem, 0.18em, uppercase): the product `h1` in the
  buy band, the pre-drop announcement `h1`, price and notices (price
  untracked, in `mute`). The cart count is mono at 10px, tabular numerals.

### Named Rules
**The Small Voice Rule.** Headlines stay small. The pre-drop home page's `h1`
is 0.75rem monospace; nothing on the commerce surface is set larger than the
legal pages' 1.875rem. Scale comes from the sky and the photograph.

**The Label Tracking Rule.** Uppercase text is always tracked at
`--tracking-label` (0.18em). Uppercase without tracking, or tracking at any
other value, is drift (the PIN-style mono input at 0.25em is the one
deliberate exception).

## Layout

One centred container, `max-w-7xl` (80rem), with a 1.5rem gutter that opens
to 2.5rem from `sm:` up. The safe-area insets are added to that gutter on
every edge (`viewport-fit=cover`), so text clears the notch and home
indicator while the sky stays full-bleed.

The header is sticky and see-through, a three-column grid (`1fr auto 1fr`):
the nav trigger at the start, the wordmark centred, and the sky toggle, cart
and locale switcher at the end. Its height is `--header-h` (4rem), which anchor
scroll-margins and the buy panel's sticky offset both read. A `header-veil`
caps the status-bar band with solid paper and fades to nothing below it.

The product page is a single column capped at 34rem, vertically centred in
the viewport under the header. The pre-drop announcement is centred both
ways. Legal and info pages are a 42rem prose column with 6rem vertical
padding and 2rem between sections. The footer sits 6rem below content in
`mute` at 0.75rem.

Rhythm is Tailwind's 4px scale; touch targets on primary controls are at
least 44px tall (`min-h-11`).

## Elevation & Depth

Flat. There are no box-shadows anywhere on the site. Depth comes from two
things only: the sky, which is the one layer behind everything, and blur. The
signup prompt rises from the bottom edge as glass (12px backdrop blur over a
5%-opaque paper tint, no edge of its own), and the nav drawer is a paper
panel with a hairline right edge over a 15% ink scrim.

### Named Rules
**The No-Shadow Rule.** Separation is a hairline, a fill change, or blur.
Never a drop shadow, never a glow; the sky washes soft edges out.

**The Sky Is Weather, Not Decoration Rule.** The sky may degrade or stop, but
it never leaves a white page. Its static fallback (`sky-fallback`) is a drawn
overcast deck whose densest tone tracks the shader's `CLOUD_MIN`, and it is
the whole background for reduced-motion, forced-colors and no-WebGL2
visitors. `prefers-contrast: more` flattens it to plain paper.

## Shapes

Square. Every `--radius-*` token is `0`, and `button, input, textarea,
select, img, video` are zeroed in the base layer.

### Named Rules
**The Two Circles Rule.** Exactly two things are round: the product
carousel's pagination dots, and the cart link's confirmation ring. Both are
circles or they are nothing. Each carries a `guard-allow-rounded` marker on
its line, and `scripts/check-guards.sh` fails the build on any other
`rounded-*` utility or non-zero `border-radius` in `src/`. A third circle is a
design decision written next to its declaration, never a workaround.

## Components

### Buttons
Two treatments, from `buttonVariants` (`src/components/ui/button-variants.ts`):
- **Solid:** full-width ink block with a 1px ink border, paper label text in
  the 11px tracked uppercase label style, 12px × 24px padding. Every submit
  and buy action. On hover it inverts to paper with ink text; disabled is 40%
  opacity.
- **Text:** bare uppercase tracked label, no border or fill; hover drops to
  70% opacity. Used inside the product band where a box would break the
  row's rhythm.
- **Quiet:** the icon-only sky toggle, 70% opacity at rest, full opacity and
  `accent-ink` on hover.
- **Press:** every control shares one pointer response, the `press` utility:
  colour, border and opacity ease over 150ms ease-out, and the control sinks
  1px while held (the sink only under `no-preference`).

### Inputs / Fields
- **Style:** no box. A transparent field with a single 1px ink bottom
  border, zero horizontal padding, 8px vertical. A `mono` variant sets
  wide-tracked monospace for PIN-like entry.
- **Label:** 11px uppercase tracked, in `mute`, above the field.
- **Focus:** the global focus outline only; the underline does not change
  colour, because two cues on a one-line field read as one dense rectangle.
- **Error:** 0.875rem `danger` text beneath.

### Radios (fit and size pickers)
- **Size row:** seven identical cells in a 7-column grid, unboxed lettering
  until selected, at least 44px tall. Selected or hovered: ink fill, paper
  text. Sold out: struck through in `mute`, "Épuisé" in the accessible name,
  and a CSS-only ink tooltip on hover.
- **Fit tabs:** two equal paper cells separated by 1px `line` gaps, 10px
  centred labels; selected is ink.
- **Forced colors:** selected switches to `Highlight`/`HighlightText` with a
  `ButtonBorder` edge, since ink/paper flatten to system colours.

### Checkbox
A 16px square, 1px ink border on paper, ink fill with a square-capped check
when selected. Hovering anywhere on the label tints the edge `accent-ink`.
The CASL consent box is never pre-checked.

### Links
Inline links get `underline-sweep`: a 1px hairline that draws in from the
left over 250ms on hover and focus, with colour easing to `accent-ink`. Under
forced colors it falls back to a real underline. Legal prose links are a
plain underline.

### Navigation
The header row is described in Layout. The drawer is a native `<dialog>`
sliding in from the left (300ms in, 200ms out) as a paper panel, max 20rem,
with a hairline right edge and a stacked list of sweep-underlined links.

### Signup Prompt (signature)
A bottom-anchored glass band (`prompt-veil`) that rises ~6s after load on
`cubic-bezier(0.16, 1, 0.3, 1)` over 650ms and leaves on a plain 350ms
ease-in. The page stays scrollable beneath it. Reduced transparency paints it
solid paper; forced colors give it Canvas and a real top border.

### Cart Confirmation (signature)
On any cart change the header cart link bumps in scale and a 2px
`accent-ink` circle travels out from focus-block's 4px offset to 12px. It is
the focus outline's own stroke, expanded by `outline-offset` so it stays
hard-edged. Dropped entirely under reduced motion: the count changing carries
the information.

### Focus
**The Hard Edge Rule.** Focus is a 2px solid `accent-ink` outline at a 4px
offset (`focus-block`), applied to native `:focus-visible` and to React
Aria's `data-[focus-visible]`. Never a ring, glow or box-shadow.

## Do's and Don'ts

### Do:
- **Do** take colour from the eight `@theme` tokens in `global.css`; the
  shadcn semantic names (`--color-primary` etc.) are aliases onto them, not a
  second palette.
- **Do** use `press` for controls and `underline-sweep` for links, and never
  combine either with `transition-colors`; they all set
  `transition-property` and one silently wins.
- **Do** gate anything that moves with `motion-safe:` or a
  `prefers-reduced-motion: no-preference` block. Colour easing may stay.
- **Do** set uppercase text at the 0.18em label tracking.
- **Do** give every custom indicator an explicit forced-colors rendering.
- **Do** keep every text colour at AA on paper and write the ratio beside
  any new text token.

### Don't:
- **Don't** add a radius. Two circles exist; a third needs a written reason
  and a `guard-allow-rounded` marker.
- **Don't** add shadows, glows, or soft focus rings.
- **Don't** add a dark mode to the site. Email is dark; the site is not.
- **Don't** introduce a second accent hue or a gradient on text or
  controls.
- **Don't** use `motion-reduce:transition-none` to handle reduced motion; it
  leaves the element jumping to its end state.
- **Don't** ship a webfont. Every stack is system or locally installed.
- **Don't** put photography on the public pre-drop page.
