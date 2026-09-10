#!/usr/bin/env bash
# Cheap, precise checks that hold the component-library design decisions in
# place — each one is a design rule from a specific commit, not a style
# preference, and each is far more reliable than a code-review catching a
# regression by eye. See src/components/ui/ and CLAUDE.md.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# The whole site is deliberately unrounded (global.css). shadcn primitives
# default to rounded-md/rounded-full; a future `shadcn add` re-introducing
# one would slip past a visual review far more easily than this.
#
# The one sanctioned exception is the carousel's pagination dots
# (ProductCarousel.tsx). A line may opt out by carrying the marker below —
# which is the point of spelling it that way: an exception has to be written
# down next to the class it excuses, and shows up in a diff as one.
#
# Two patterns, because a class list is not always on the same line as the
# attribute that holds it: the first catches `class="…rounded…"` inline, the
# second any Tailwind-shaped `rounded-*` inside a quoted string anywhere in a
# component — which is how a multi-line `cn(…)` call would carry one. Prose
# in these files spells utilities in `backticks`, so it doesn't match the
# second pattern.
ALLOW_ROUNDED='guard-allow-rounded'
if grep -rnE '(class|className)=(\{|")[^}"]*\brounded(-[a-zA-Z0-9]+)?\b' src/ | grep -v "$ALLOW_ROUNDED"; then
  echo "✘ found a 'rounded' utility class — this site has no radii (see global.css)" >&2
  fail=1
fi
if grep -rnE "['\"][^'\"]*\brounded-[a-zA-Z0-9[]" src/ --include=*.tsx --include=*.astro | grep -v "$ALLOW_ROUNDED"; then
  echo "✘ found a 'rounded-*' class in a quoted string — this site has no radii (see global.css)" >&2
  fail=1
fi

# Same rule, inline styles. Outbound email (src/lib/email.ts) can't use
# Tailwind classes at all, so the check above can't see it — this catches a
# hand-written `style="border-radius:4px"` slipping into the shell. Two
# passes rather than one lookahead regex: -P isn't available in every grep
# this runs under (notably BSD grep, plain -E only), so this lists every
# declaration and then subtracts the "0" / "0px" ones a plain ERE can match
# directly.
if grep -rnE 'border-radius:\s*[^;]+;' src/ | grep -vE 'border-radius:\s*0(px)?\s*;'; then
  echo "✘ found a non-zero inline border-radius — this site has no radii (see global.css)" >&2
  fail=1
fi

# .astro files must import shared button/field variants from the plain .ts
# modules only (src/components/ui/*-variants.ts), never from the .tsx
# primitives — importing the .tsx would pull react-aria-components into the
# Astro server graph. See the header comment in button.tsx.
if grep -rnE "from ['\"]\.\./?.*components/ui/(button|checkbox|radio-group|text-field)(\.tsx)?['\"]" src/ --include=*.astro; then
  echo "✘ an .astro file imports a react-aria-components .tsx primitive directly" >&2
  fail=1
fi

# CASL requires express consent (CLAUDE.md non-negotiable #3). RAC's
# Checkbox uses isSelected/defaultSelected, not checked — defaultSelected
# would pre-check the consent box, which must never happen. Matches the
# prop being set (=) or used as an object key (:), not prose mentioning it.
if grep -rnE 'defaultSelected(=|:)' src/; then
  echo "✘ found 'defaultSelected' set — the consent checkbox must never be pre-checked" >&2
  fail=1
fi

exit $fail
