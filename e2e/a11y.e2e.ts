import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ROUTES } from '../src/i18n/utils'
import { LOCALES } from '../src/i18n/config'

// Every ROUTES entry × both locales — 18 URLs (9 route ids since #47 added
// returns/shipping). All of them are public now that the pre-launch gate is
// gone, so the scan needs no authentication.
const paths = LOCALES.flatMap((locale) =>
  (Object.keys(ROUTES) as (keyof typeof ROUTES)[]).map((id) => ROUTES[id][locale])
)

/**
 * axe's color-contrast rule can't resolve a CSS gradient — or a blurred,
 * translucent backdrop-filter — to a flat background color, so any text
 * painted over either comes back `incomplete` rather than pass/fail;
 * asserting only on `violations` would pass while contrast goes silently
 * unevaluated wherever one sits behind text. Sky.astro's fixed full-page
 * radial-gradient is the gradient case; SignupPrompt.astro's `prompt-veil`
 * (its backdrop-filter: blur ground, sitting directly over that same sky
 * layer) is the backdrop-filter one. Kept generic rather than hardcoded
 * selectors — Tailwind's arbitrary-value classes for either aren't valid
 * CSS selectors without heavy escaping anyway — by flattening every element
 * whose *computed* background or backdrop-filter is one of these to the
 * real paper color.
 */
async function neutralizeUnresolvableBackgrounds(page: Page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const style = getComputedStyle(el)
      if (style.backgroundImage.includes('gradient') || style.backdropFilter !== 'none') {
        el.style.backgroundImage = 'none'
        el.style.backdropFilter = 'none'
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
// The pre-contract page's "Right of withdrawal" / "Droit de résolution" row
// (its longest <dd>, the one most likely to wrap) hits the same axe quirk
// for the same reason — a <dt> immediately before it in the same <div> —
// confirmed the same way: elementsFromPoint at the <dd>'s box shows only its
// own ancestor chain, no actual overlapping element.
//
// axe's generated CSS selector for these nodes isn't stable — it comes back
// as "span" on some pages but ".items-start > span" on others, depending on
// what else is on the page — so match on the node's rendered markup instead:
// these are the only two "partially obscuring" incomplete results whose html
// starts with one of the two prefixes below, which is specific enough that a
// genuinely new incomplete result elsewhere still fails.
function isKnownSafeConsentLabelOverlap(node: {
  html: string
  any: { data?: { messageKey?: string } | null }[]
}) {
  return (
    (node.html.startsWith('<span class="text-mute">') ||
      node.html.startsWith('<dd class="mt-1">')) &&
    node.any.some((a) => a.data?.messageKey === 'elmPartiallyObscuring')
  )
}

/**
 * axe only sees rendered markup, so anything that starts collapsed or
 * hidden would drop out of the scan entirely. Two such cases today: a
 * <details> (none currently on the site, kept generic in case one returns)
 * and SignupPrompt.astro's `#signup-prompt`, which starts `hidden` and only
 * becomes visible ~6s after load via its own script — forcing it open here
 * is the same idea as a disclosure's expand, just for an element that isn't
 * a native one.
 */
async function openHiddenContent(page: Page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('details')) el.open = true
    const prompt = document.getElementById('signup-prompt')
    if (prompt) prompt.hidden = false
  })
}

/**
 * axe's color-contrast check only samples pixels the browser actually
 * painted for the current viewport — it has no notion of "below the fold".
 * An element straddling the viewport's bottom edge is genuinely unpainted
 * on its lower portion, so axe reports the same "partially
 * obscured/obscuring" incomplete result it uses for a real stacking overlap
 * (issue #98), but `relatedNodes` comes back empty (or names an unrelated
 * background layer) because nothing is really on top — confirmed with
 * `elementsFromPoint` at the flagged node's box, same technique as the
 * consent-checkbox/pre-contract cases above: nothing renders there because
 * the browser hasn't painted that far down the page at all.
 *
 * `conditions.astro` / `en/terms.astro`'s "No warranty" section is the
 * case that surfaced this: at the suite's default 1280×720 it lands at
 * y≈694–740, straddling y=720 purely by how much copy happens to precede
 * it — borderline enough that it only reproduces for one locale at a time
 * depending on what else renders in the header that day. Growing the
 * viewport to the full document height before the scan makes every element
 * paint at once, matching what a visitor actually sees once they scroll,
 * and is done last so it sees the final DOM (`openHiddenContent`'s forced
 * `<details>`/signup-prompt reveal can change the document's height).
 * `#signup-prompt` (`fixed inset-x-0 bottom-0`) simply re-anchors to the
 * bottom of the grown viewport along with the resize, the same as it would
 * re-anchor to the bottom of a real, shorter browser viewport a visitor
 * scrolled within — there's nothing further down a grown viewport for it
 * to newly overlap.
 */
async function growViewportToFullPage(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: viewport?.width ?? 1280, height })
}

for (const path of paths) {
  test(`a11y: ${path}`, async ({ page }) => {
    await page.goto(path)
    await openHiddenContent(page)
    await neutralizeUnresolvableBackgrounds(page)
    await growViewportToFullPage(page)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])

    const unresolvedContrast = results.incomplete
      .filter((r) => r.id === 'color-contrast')
      .flatMap((r) => r.nodes)
      .filter((n) => !isKnownSafeConsentLabelOverlap(n))

    expect(unresolvedContrast, JSON.stringify(unresolvedContrast, null, 2)).toEqual([])
  })
}
