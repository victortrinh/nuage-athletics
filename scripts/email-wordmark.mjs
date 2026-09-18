/**
 * Regenerates public/img/wordmark-email.png — the brand mark used in the
 * header of every outbound email (src/lib/email.ts:renderEmailShell).
 *
 * Run by hand (`npm run email:wordmark`), not part of the build: the output
 * is a brand asset that changes only when the artwork does, same contract as
 * scripts/og-image.mjs.
 *
 * Why this can't just be an <img src="/logo-nuage.svg">, the way Logo.astro
 * inlines the source paths on the site itself:
 *
 *   1. Email clients need an absolute, hosted raster — Gmail and Outlook
 *      both strip inline SVG outright, and a relative src has nothing to
 *      resolve against inside a message.
 *   2. Logo.astro inlines these paths with fill="currentColor" so the header
 *      can hand it ink and a dark ground can hand it paper. Email has no
 *      such context to inherit — the fill has to be baked in.
 *
 * One asset, light lettering on the card's own dark ground, and opaque
 * rather than transparent. The email is dark in every client by design (see
 * EMAIL_THEME in email.ts: clients' dark-mode inverters only ever darken
 * light backgrounds and leave images alone, so a dark design is the one
 * they all leave as is). The baked ground is the net for the remaining
 * case: a client that inverts the card to light anyway can't touch the
 * image, so the mark still reads as white lettering on a dark block rather
 * than white lettering on nothing.
 *
 * The artwork itself lives in scripts/lib/wordmark-art.mjs, shared with
 * scripts/print-wordmark.mjs — the same mark, baked for a different medium.
 *
 * sharp is not a direct dependency — it arrives with Astro, whose image
 * service the Cloudflare adapter runs at build time (`imageService:
 * 'compile'`). If this ever fails to resolve, that's why.
 */
import sharp from 'sharp'
import { wordmarkSvg } from './lib/wordmark-art.mjs'

/** email.ts EMAIL_THEME.ink / .paper — keep these two literals in sync with
 * that export; test/email.test.ts asserts it. */
const INK = '#f2f2f0'
const PAPER = '#161616'

/** Displayed at 120px wide in the email (WORDMARK_WIDTH in email.ts);
 * rendered well past 2x so it stays sharp at retina. */
const { svg, width, height } = wordmarkSvg({ width: 320, fg: INK, bg: PAPER })

await sharp(Buffer.from(svg)).png().toFile('public/img/wordmark-email.png')

console.log(`Wrote public/img/wordmark-email.png (${width}x${height})`)
