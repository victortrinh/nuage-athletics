import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ROUTES } from '../src/i18n/utils'
import { LOCALES } from '../src/i18n/config'

// Every ROUTES entry × both locales — 16 URLs, including /acces and
// /en/access (ROUTES.gate), which pass through the lock regardless of
// storageState (see isGatePath in src/lib/gate.ts).
const paths = LOCALES.flatMap((locale) =>
  (Object.keys(ROUTES) as (keyof typeof ROUTES)[]).map((id) => ROUTES[id][locale])
)

/**
 * axe's color-contrast rule can't resolve a CSS gradient to a background
 * color, so any text painted over one comes back `incomplete` rather than
 * pass/fail — asserting only on `violations` would pass while contrast goes
 * silently unevaluated wherever a gradient sits behind text. Sky.astro's
 * fixed full-page radial-gradient is the one spot left that does this
 * (ProductGallery's placeholder tiles, the other original source, are gone
 * now that real product photography replaced them). Kept generic rather
 * than a hardcoded selector — Tailwind's arbitrary-value gradient classes
 * aren't valid CSS selectors without heavy escaping anyway — by flattening
 * every element whose *computed* background is a gradient to the real
 * paper color.
 */
async function neutralizeGradients(page: Page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const bg = getComputedStyle(el).backgroundImage
      if (bg.includes('gradient')) {
        el.style.backgroundImage = 'none'
        el.style.backgroundColor = '#fafafa'
      }
    }
  })
}

// The CASL consent checkbox sits inside a flex <label> immediately before
// its label text (SignupForm.tsx). axe's color-contrast check flags the
// text `incomplete` ("partially overlaps other elements") purely because of
// that adjacent sibling — confirmed by inspecting elementsFromPoint at the
// text's box, which shows no actual overlapping element, and this is
// unchanged, pre-existing markup this branch doesn't touch. The real
// contrast (text-mute #63696e on paper #fafafa, 5.33:1) is already
// documented safe in global.css.
//
// axe's generated CSS selector for this node isn't stable — it comes back
// as "span" on the gate pages but ".items-start > span" on the home page,
// depending on what else is on the page — so match on the node's rendered
// markup instead: this is the only "partially obscuring" incomplete result
// whose html is exactly `<span class="text-mute">`, which is specific
// enough that a genuinely new incomplete result elsewhere still fails.
function isKnownSafeConsentLabelOverlap(node: {
  html: string
  any: { data?: { messageKey?: string } | null }[]
}) {
  return (
    node.html.startsWith('<span class="text-mute">') &&
    node.any.some((a) => a.data?.messageKey === 'elmPartiallyObscuring')
  )
}

// Sky.astro's `sky-fallback` and `sky-canvas` are both `absolute inset-0`
// inside a `fixed inset-0 -z-10` wrapper — pinned to the viewport, not the
// document, and `sky-canvas` sits at `opacity-0` until its script fades it
// in. Two stacked, partly-transparent full-viewport layers at the same
// query point is what axe can't cleanly resolve into a single background
// color ("elmPartiallyObscured" — the reverse of the consent label's case
// above, where the *foreground* text was flagged as obscuring; here it's the
// flagged text's own background that's ambiguous). It doesn't matter which
// layer axe would pick: `body` (global.css) paints `--color-paper` under all
// of it regardless, and this paragraph has no color override, so it
// inherits `body`'s `--color-ink` — ~19.5:1, nowhere near the 4.5:1 line.
//
// This only started firing on ProductActions' notify-me copy because that
// paragraph's line-wrap shifts with its text length, moving its box within
// the first viewport height where the fixed sky sits behind it — a layout
// accident, not a property of the copy, so match on the node's own html
// (stable here — this paragraph has one fixed class list in both locales)
// rather than on which words happen to be in it.
function isKnownSafeSkyBackgroundOverlap(node: {
  html: string
  any: { data?: { messageKey?: string } | null }[]
}) {
  return (
    node.html.startsWith('<p class="mt-3 text-sm leading-relaxed">') &&
    node.any.some((a) => a.data?.messageKey === 'elmPartiallyObscured')
  )
}

/**
 * axe only sees rendered markup, so the gate's signup form — which sits
 * inside a collapsed <details> (GateScreen.astro) — would drop out of the
 * scan entirely. Expand every disclosure first so the scan covers what a
 * visitor who opens it sees. Generic rather than gate-specific: any
 * <details> added later is covered without touching this file.
 */
async function expandDisclosures(page: Page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('details')) el.open = true
  })
}

for (const path of paths) {
  test(`a11y: ${path}`, async ({ page }) => {
    await page.goto(path)
    await expandDisclosures(page)
    await neutralizeGradients(page)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      // Third-party markup, not ours to fix.
      .exclude('iframe[src*="challenges.cloudflare.com"]')
      .analyze()

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])

    const unresolvedContrast = results.incomplete
      .filter((r) => r.id === 'color-contrast')
      .flatMap((r) => r.nodes)
      .filter((n) => !isKnownSafeConsentLabelOverlap(n) && !isKnownSafeSkyBackgroundOverlap(n))

    expect(unresolvedContrast, JSON.stringify(unresolvedContrast, null, 2)).toEqual([])
  })
}
