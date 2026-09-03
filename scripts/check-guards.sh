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
if grep -rnE '(class|className)=(\{|")[^}"]*\brounded(-[a-zA-Z0-9]+)?\b' src/; then
  echo "✘ found a 'rounded' utility class — this site has no radii (see global.css)" >&2
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
