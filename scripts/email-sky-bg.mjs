/**
 * Regenerates public/img/email-sky.png — the backdrop behind the message
 * card in every outbound email (src/lib/email.ts:renderEmailShell).
 *
 * Run by hand (`node scripts/email-sky-bg.mjs`), not part of the build, same
 * contract as scripts/og-image.mjs and scripts/email-wordmark.mjs.
 *
 * Email can't run Sky.astro's WebGL canvas, so this stands in for it the
 * way the `sky-fallback` utility (global.css) does on the site itself: the
 * same soft masses at the same positions — but over a near-black wash
 * rather than sky-fallback's near-white, because the email is dark in every
 * client by design (see EMAIL_THEME in email.ts). The masses are a lighter
 * grey than sky-fallback's rgb(158,158,158) so they still read as lit cloud
 * against that base rather than disappearing into it, and the wash sits
 * slightly below the card's own `#161616` so the card floats on it.
 *
 * It's a raster reproduction of that CSS rather than a literal port —
 * email's CSS `background-image` support is too inconsistent to build nine
 * stacked radial-gradients out of (Outlook's Word engine ignores
 * background-image entirely), so this bakes the same look to a single PNG
 * and the shell wires it in through the legacy HTML `background=` attribute,
 * which Outlook *does* still honour on <table>/<td>.
 *
 * Sized well past any realistic viewing width so it never visibly tiles —
 * there's no HTML equivalent of background-size to stop that.
 *
 * sharp is not a direct dependency — it arrives with Astro, whose image
 * service the Cloudflare adapter runs at build time (`imageService:
 * 'compile'`). If this ever fails to resolve, that's why.
 */
import sharp from 'sharp'

const WIDTH = 1600
const HEIGHT = 1200

/** Lighter than sky-fallback's rgb(158,158,158) — see the header comment. */
const GREY = '110,110,112'

/**
 * Position/size/opacity lifted straight from the `sky-fallback` utility's
 * radial-gradient stack (global.css) — percentages of the element, same
 * coordinate frame here. Each becomes one heavily blurred ellipse rather
 * than a true radial gradient: a large blur radius produces the same soft
 * falloff a radial-gradient's stops do, without needing SVG gradients that
 * some rasterizers handle inconsistently.
 */
const MASSES = [
  { cx: 18, cy: 24, rx: 19, ry: 15, opacity: 0.4 },
  { cx: 34, cy: 16, rx: 15, ry: 11, opacity: 0.34 },
  { cx: 62, cy: 32, rx: 22, ry: 13, opacity: 0.36 },
  { cx: 82, cy: 22, rx: 13, ry: 10, opacity: 0.3 },
  { cx: 12, cy: 62, rx: 25, ry: 15, opacity: 0.4 },
  { cx: 48, cy: 74, rx: 21, ry: 14, opacity: 0.44 },
  { cx: 86, cy: 66, rx: 19, ry: 13, opacity: 0.36 },
  // The deck's base, wide and mostly below the fold.
  { cx: 58, cy: 100, rx: 35, ry: 17, opacity: 0.46 },
]

function ellipsesFor(grey) {
  return MASSES.map(
    ({ cx, cy, rx, ry, opacity }) =>
      `<ellipse cx="${(cx / 100) * WIDTH}" cy="${(cy / 100) * HEIGHT}" rx="${(rx / 100) * WIDTH}" ry="${(ry / 100) * HEIGHT}" fill="rgb(${grey})" opacity="${opacity}" />`
  ).join('\n  ')
}

function svgFor({ stops, grey }) {
  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      ${stops.map(({ offset, color }) => `<stop offset="${offset}" stop-color="${color}" />`).join('\n      ')}
    </linearGradient>
    <filter id="soften" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="70" />
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#base)" />
  <g filter="url(#soften)">
  ${ellipsesFor(grey)}
  </g>
</svg>`
}

const svg = svgFor({
  grey: GREY,
  // The 40% stop is OUTER_BG in email.ts — the solid colour clients show
  // before images load, so the two must agree.
  stops: [
    { offset: '0%', color: '#141414' },
    { offset: '40%', color: '#0d0d0d' },
    { offset: '100%', color: '#080808' },
  ],
})

await sharp(Buffer.from(svg)).png({ quality: 82 }).toFile('public/img/email-sky.png')

console.log(`Wrote public/img/email-sky.png (${WIDTH}x${HEIGHT})`)
