/**
 * Regenerates public/img/wordmark-print.png — the brand mark used at the top
 * of the Shopify packing slip (shopify/src/print/shell.ts).
 *
 * Run by hand (`npm run print:wordmark`), not part of the build: same
 * contract as scripts/email-wordmark.mjs, which this is the print-medium
 * counterpart to. The artwork is shared with it (scripts/lib/wordmark-art.mjs);
 * only the colours and the resolution differ, and both differ because this
 * one is going onto paper:
 *
 *   - **Ink on nothing, not paper on ink.** The email asset is light
 *     lettering on a baked dark ground, because an email's ground is a card
 *     this codebase drew and a client may invert (EMAIL_THEME's doc
 *     comment). A packing slip's ground is the sheet in the printer. So the
 *     lettering is PRINT_THEME.ink and the ground is transparent — an opaque
 *     near-white block would print as a visible rectangle on any paper that
 *     isn't exactly that white, which is all paper.
 *   - **Rendered for a printer, not a screen.** 960px wide, displayed at
 *     WORDMARK_WIDTH (160) in the slip, is ~575 dpi on the page. The email
 *     asset's 320px would be ~190 dpi there — fine on a monitor, visibly
 *     soft in toner.
 *
 * Shopify renders the packing slip in the admin and prints it from the
 * browser, so an inline <svg> would in principle be sharper still and need
 * no hosted asset at all. It is a raster for the same reason the email one
 * is: this file is pasted into a Shopify admin field whose sanitiser this
 * repo does not control or get to test against, and a mark that silently
 * fails to render is worse than one that is merely 575 dpi. See
 * shopify/print/README.md — confirming whether inline SVG survives is a
 * listed verification step, not an assumption baked in here.
 */
import sharp from 'sharp'
import { wordmarkSvg } from './lib/wordmark-art.mjs'

/** shopify/src/print/theme.ts PRINT_THEME.ink — keep this literal in sync
 * with that export; test/print.test.ts asserts it. */
const INK = '#0a0a0a'

const { svg, width, height } = wordmarkSvg({ width: 960, fg: INK, bg: null })

await sharp(Buffer.from(svg)).png().toFile('public/img/wordmark-print.png')

console.log(`Wrote public/img/wordmark-print.png (${width}x${height})`)
