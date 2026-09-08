/**
 * Regenerates public/img/og-default.jpg — the social / link-preview card.
 *
 * Run by hand (`node scripts/og-image.mjs`), not part of the build: the
 * output is a brand asset that changes when the photography does, roughly
 * never, and a build step that rewrites a committed binary on every CI run
 * would show up as a permanent diff.
 *
 * Two things about the source make this necessary rather than a matter of
 * taste, and both are why `Seo.astro` can't just point og:image at the
 * product webp directly:
 *
 *   1. The flat-lays have a TRANSPARENT background (verified: alpha 0 in
 *      every corner). On the site they sit on the paper ground. Unfurlers
 *      composite transparency onto black about as often as onto white, and
 *      this garment is near-black — half the previews would be a dark shape
 *      on a dark field. Flattening onto paper here removes the coin flip.
 *   2. WebP support across unfurlers (LinkedIn especially) is still uneven
 *      in a way JPEG's simply isn't. This is the one image whose whole job
 *      is being fetched by someone else's parser.
 *
 * The card needs no lettering of its own: the wordmark is printed on the
 * garment's chest, and every unfurl renders og:title and og:description as
 * real text beside the image anyway.
 *
 * sharp is not a direct dependency — it arrives with Astro, whose image
 * service the Cloudflare adapter runs at build time (`imageService:
 * 'compile'`). If this ever fails to resolve, that's why.
 */
import sharp from 'sharp'

/** 1200x630 is the 1.91:1 card every major unfurler crops toward. */
const CARD = { width: 1200, height: 630 }

/** --color-paper in src/styles/global.css. The site's ground, and this card's. */
const PAPER = { r: 0xfa, g: 0xfa, b: 0xfa, alpha: 1 }

const SOURCE = 'public/img/ls-01-classic-front.webp'
const OUTPUT = 'public/img/og-default.jpg'

/**
 * Inset rather than full-bleed. The garment reads as a photographed object
 * on paper, which is how the product page frames it; bled to the edges it
 * reads as a texture.
 */
const GARMENT_WIDTH = 1080

const garment = await sharp(SOURCE)
  .resize({ width: GARMENT_WIDTH })
  .toBuffer({ resolveWithObject: true })

await sharp({ create: { ...CARD, channels: 4, background: PAPER } })
  .composite([
    {
      input: garment.data,
      left: Math.round((CARD.width - garment.info.width) / 2),
      top: Math.round((CARD.height - garment.info.height) / 2),
    },
  ])
  .flatten({ background: PAPER })
  .jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true })
  .toFile(OUTPUT)

console.log(`wrote ${OUTPUT} (${CARD.width}x${CARD.height})`)
