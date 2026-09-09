/**
 * Regenerates public/img/email-sky.png — the backdrop behind the message
 * card in every outbound email (src/lib/email.ts:renderEmailShell).
 *
 * Run by hand (`node scripts/email-sky-bg.mjs`), not part of the build, same
 * contract as scripts/og-image.mjs and scripts/email-wordmark.mjs.
 *
 * Email can't run Sky.astro's WebGL canvas, so this stands in for it the
 * way the `sky-fallback` utility (global.css) does on the site itself: soft
 * grey masses over a light wash, same rgb(158,158,158) hue and the same mass
 * positions. The base tone is darker than sky-fallback's near-white,
 * deliberately — sky-fallback sits directly behind page text, but this sits
 * behind a paper-white card (renderEmailShell), and needs to read as a
 * backdrop the card floats on rather than disappear into it.
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

/** Same grey the site's sky-fallback masses use. */
const GREY = '158,158,158'

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

const ellipses = MASSES.map(
  ({ cx, cy, rx, ry, opacity }) =>
    `<ellipse cx="${(cx / 100) * WIDTH}" cy="${(cy / 100) * HEIGHT}" rx="${(rx / 100) * WIDTH}" ry="${(ry / 100) * HEIGHT}" fill="rgb(${GREY})" opacity="${opacity}" />`
).join('\n  ')

const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f2f2f0" />
      <stop offset="40%" stop-color="#eaeae8" />
      <stop offset="100%" stop-color="#e2e2e0" />
    </linearGradient>
    <filter id="soften" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="70" />
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#base)" />
  <g filter="url(#soften)">
  ${ellipses}
  </g>
</svg>`

await sharp(Buffer.from(svg))
  .png({ quality: 82 })
  .toFile('public/img/email-sky.png')

console.log(`Wrote public/img/email-sky.png (${WIDTH}x${HEIGHT})`)
