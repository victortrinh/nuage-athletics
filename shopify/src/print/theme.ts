/**
 * The packing slip's palette — deliberately the inverse of
 * src/lib/email.ts's `EMAIL_THEME`, and the one place in this repo where
 * that inversion is correct rather than a mistake.
 *
 * `EMAIL_THEME` is dark in every client because email has no reliable dark
 * mode: every client-side inverter darkens light backgrounds and lightens
 * dark text, so a design that is already dark is the only one they all leave
 * alone. None of that reasoning survives the trip to paper. A printed sheet
 * has no dark mode, no inverter, and no client — it has toner. So the
 * packing slip is ink on paper, which is also what the site itself is
 * (global.css's `--color-ink` / `--color-mute` / `--color-line`, copied here
 * as literals for the same reason EMAIL_THEME copies rather than imports:
 * Liquid pasted into a Shopify admin field can't reference a custom
 * property this codebase defines).
 *
 * `paper` is pure white, not the site's `--color-paper` (#fafafa). On screen
 * that near-white is the page's ground; on paper the ground is the sheet,
 * and painting #fafafa across it means a printer laying down a faint tint
 * over every square inch — visible as a grey box on plain paper, and a real
 * cost in toner on every order. So nothing in the slip sets a page
 * background at all, and this constant exists to be the *absence* the
 * generator's lint can check for.
 *
 * `scripts/print-wordmark.mjs` bakes `ink` into public/img/wordmark-print.png;
 * test/print.test.ts pins the literal so the mark and the type can't drift
 * apart, the same contract test/email.test.ts holds for the email pair.
 */
export const PRINT_THEME = {
  /** global.css --color-ink. Also baked into wordmark-print.png. */
  ink: '#0a0a0a',
  /** The sheet. Never painted — see the doc comment above. */
  paper: '#ffffff',
  /** global.css --color-mute. Labels and secondary lines. */
  mute: '#63696e',
  /** global.css --color-line. Rules between line items. */
  line: '#dcdcdc',
  /** Same stacks as the site and the email. No webfont: a Shopify print
   * view has no way to load one this repo controls, and a packing slip that
   * waits on a font is a packing slip that prints blank. */
  fontSans: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`,
  fontDisplay: `Futura, 'Century Gothic', 'Avenir Next', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`,
  trackingLabel: '0.18em',
} as const

/** Absolute path to the committed print wordmark. See
 * scripts/print-wordmark.mjs for why it is a raster, transparent-grounded
 * and rendered at 960px. */
export const PRINT_WORDMARK_PATH = '/img/wordmark-print.png'

/** Displayed width on the slip; the source asset is 960px wide, so this is
 * ~575 dpi on the printed page. */
export const PRINT_WORDMARK_WIDTH = 160
export const PRINT_WORDMARK_HEIGHT = 39
