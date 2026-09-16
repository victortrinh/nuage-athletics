import type { Locale } from '../i18n/config.ts'
import { UI, type Dict } from '../i18n/ui.ts'
import { SENDER_IDENTITY, senderAddressConfigured } from './consent.ts'

export const RESEND_ENDPOINT = 'https://api.resend.com/emails'

interface SendArgs {
  apiKey: string | undefined
  address: string | undefined
  to: string
  locale: Locale
  siteUrl: string
  token: string
}

/**
 * The site's design tokens (src/styles/global.css), flattened to literal
 * hexes and font stacks. Email cannot reference CSS custom properties —
 * Outlook's Word renderer drops `var()` entirely and Gmail's sanitizer strips
 * unrecognised declarations — so this is a copy, not a reference, and a copy
 * can drift. test/email.test.ts parses global.css and asserts these still
 * match it; update both together.
 */
export const EMAIL_THEME = {
  ink: '#0a0a0a',
  paper: '#fafafa',
  mute: '#63696e',
  line: '#dcdcdc',
  accentInk: '#3a5fd9',
  fontSans: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`,
  // Wordmark + headings only, same as the site — falls back through other
  // geometric sans before the system default, no webfont shipped.
  fontDisplay: `Futura, 'Century Gothic', 'Avenir Next', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`,
  trackingLabel: '0.18em',
} as const

/**
 * Dark-mode counterpart to EMAIL_THEME. Unlike the light tokens, these don't
 * mirror anything in global.css — the site itself has no dark mode (see
 * CLAUDE.md's non-negotiables); this palette exists only for mail clients
 * that render one.
 *
 * The old approach was `color-scheme: light only` / `supported-color-schemes:
 * light only` on the shell, asking clients to leave the message alone. That
 * fails in practice: several major webmail clients (Outlook.com among them —
 * see issue #103) auto-dark-mode a message regardless of that meta pair,
 * inverting or relightening every colour they can see in the markup while
 * leaving raster images untouched. The paper-background wordmark PNG was
 * built to survive exactly that (email-wordmark.mjs's old doc comment), but
 * it only survives being left alone — once the surrounding card inverts to
 * near-black around it, the image's own light background reads as a stray
 * white box (the bug in the screenshot on #103).
 *
 * The fix is to stop opting out and actually declare both themes: an
 * explicit `@media (prefers-color-scheme: dark)` block in the shell's <style>
 * is what tells Outlook.com's renderer (and others with the same heuristic)
 * that this message already handles dark mode, which is what turns off their
 * auto-invert for it — a well-documented behaviour, not a guess. Every
 * colour below is chosen independently of the light palette (not just an
 * algorithmic invert) so it stays legible and on-brand once that block is
 * the thing actually drawing the dark render, and the wordmark/sky assets
 * get true dark siblings (wordmark-email-dark.png, email-sky-dark.png)
 * rather than relying on transparency.
 */
export const EMAIL_THEME_DARK = {
  ink: '#f2f2f0',
  paper: '#161616',
  mute: '#9a9fa4',
  line: '#3a3a3a',
  accentInk: '#8fa8ff',
} as const

/** Absolute path to the committed wordmark PNG. See scripts/email-wordmark.mjs. */
export const WORDMARK_PATH = '/img/wordmark-email.png'
/** Dark-mode sibling, swapped in by the `prefers-color-scheme: dark` block
 * in renderEmailShell. See scripts/email-wordmark.mjs. */
export const WORDMARK_DARK_PATH = '/img/wordmark-email-dark.png'
/** Displayed width; the source asset (320x79, scripts/email-wordmark.mjs) is
 * more than 2x this, so it stays sharp at retina. Small on purpose — this
 * sits inside a padded card now, not full-width across the message. */
const WORDMARK_WIDTH = 120
const WORDMARK_HEIGHT = 29

/**
 * The outer backdrop around the message card, standing in for the site's own
 * background (Sky.astro's WebGL canvas / the `sky-fallback` utility in
 * global.css) — email can't run either. OUTER_BG_IMAGE is a raster
 * reproduction of sky-fallback's soft grey masses (scripts/email-sky-bg.mjs,
 * public/img/email-sky.png), wired in through the legacy HTML `background=`
 * attribute — Outlook's Word engine ignores CSS `background-image` outright
 * but has always honoured that attribute on <table>/<td>. OUTER_BG is the
 * solid colour every client falls back to first: images are typically
 * blocked until a recipient explicitly loads them, so most opens see this,
 * not the picture.
 */
export const OUTER_BG = '#e8e8e6'
/** Dark-mode counterpart to OUTER_BG, set via the `prefers-color-scheme:
 * dark` block — see EMAIL_THEME_DARK. */
export const OUTER_BG_DARK = '#0d0d0d'
/** Absolute path to the committed sky asset. See scripts/email-sky-bg.mjs. */
export const SKY_BG_PATH = '/img/email-sky.png'
/** Dark-mode sibling. See scripts/email-sky-bg.mjs. */
export const SKY_BG_DARK_PATH = '/img/email-sky-dark.png'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Shared branded shell for every outbound email. CASL requires sender
 * identification, a physical mailing address, and an unsubscribe mechanism in
 * every *commercial* email — this is the one place that renders all three, so
 * every commercial call site (confirmation emails, broadcasts) gets them
 * automatically. A transactional email doesn't require an unsubscribe link
 * under CASL — unsubUrl is optional here and that line is simply omitted
 * when there's nothing to unsubscribe from.
 *
 * Table-based layout, not divs: Outlook's Word rendering engine ignores
 * max-width on a div but honours a fixed-width <table>, and the MSO
 * conditional comment below is what keeps the column at 520px there instead
 * of full-bleed. `color-scheme: light dark` plus the `@media
 * (prefers-color-scheme: dark)` block below declare both themes explicitly —
 * see the doc comment on EMAIL_THEME_DARK for why that's what actually stops
 * clients like Outlook.com from auto-dark-moding this message on their own
 * terms.
 *
 * The message itself sits in a paper card — border, not shadow, matching the
 * site's own "no shadows" rule — floated on the sky backdrop (OUTER_BG /
 * SKY_BG_PATH, see the doc comment on OUTER_BG). `bgcolor`/`background`
 * attributes ride alongside the equivalent CSS on both the outer wrapper and
 * the card because Outlook's Word engine ignores `background`/
 * `background-color`/`background-image` in `style=` but does honour the
 * HTML attributes. Content is centered (`align`/`text-align` on every cell,
 * not just the outer wrapper) because table-cell alignment doesn't reliably
 * inherit down through nested tables in every client.
 *
 * Every colour that needs to flip in dark mode carries both an inline style
 * (the value every client renders by default, including ones that ignore
 * the media query entirely) and one of the `email-*` classes the `<style>`
 * block below overrides with `!important` — inline styles otherwise always
 * win over a stylesheet, media query or not, so the class rules have no
 * other way to take effect. The wordmark is the same idea applied to an
 * image instead of a colour: two `<img>`s, one hidden by default and shown
 * only under the dark media query.
 */
export function renderEmailShell({
  locale,
  heading,
  bodyHtml,
  unsubUrl,
  siteUrl,
  preheader,
  address,
}: {
  locale: Locale
  heading: string
  bodyHtml: string
  unsubUrl?: string
  siteUrl: string
  preheader?: string
  address: string
}): string {
  const d = UI[locale]
  const t = EMAIL_THEME
  const td = EMAIL_THEME_DARK
  const wordmarkUrl = `${siteUrl}${WORDMARK_PATH}`
  const wordmarkDarkUrl = `${siteUrl}${WORDMARK_DARK_PATH}`
  const skyUrl = `${siteUrl}${SKY_BG_PATH}`
  const skyDarkUrl = `${siteUrl}${SKY_BG_DARK_PATH}`

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <!--[if mso]>
    <noscript>
      <xml>
        <o:OfficeDocumentSettings>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
    </noscript>
    <![endif]-->
    <title>${escapeHtml(heading)}</title>
    <style>
      @media (prefers-color-scheme: dark) {
        .email-outer-bg { background-color: ${OUTER_BG_DARK} !important; }
        table.email-outer-bg { background-image: url('${skyDarkUrl}') !important; }
        .email-card { background-color: ${td.paper} !important; border-color: ${td.line} !important; }
        .email-ink { color: ${td.ink} !important; }
        .email-mute { color: ${td.mute} !important; }
        .email-accent { color: ${td.accentInk} !important; }
        .email-line { border-top-color: ${td.line} !important; }
        .email-btn { background-color: ${td.ink} !important; color: ${td.paper} !important; }
        .email-logo-light { display: none !important; }
        .email-logo-dark { display: block !important; }
      }
    </style>
  </head>
  <body class="email-outer-bg" style="margin:0;padding:0;background-color:${OUTER_BG};">
    ${
      preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>`
        : ''
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-outer-bg" bgcolor="${OUTER_BG}" background="${skyUrl}" style="background-color:${OUTER_BG};background-image:url('${skyUrl}');background-repeat:no-repeat;background-position:center top;background-size:cover;">
      <tr>
        <td align="center" style="padding:48px 16px;">
          <!--[if mso]>
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td>
          <![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-card" bgcolor="${t.paper}" style="max-width:520px;background-color:${t.paper};border:1px solid ${t.line};">
            <tr>
              <td align="center" class="email-ink" style="padding:40px 32px;font-family:${t.fontSans};color:${t.ink};text-align:center;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="padding:0 0 28px;text-align:center;">
                      <img
                        src="${wordmarkUrl}"
                        width="${WORDMARK_WIDTH}"
                        height="${WORDMARK_HEIGHT}"
                        alt="${escapeHtml(d.brand)}"
                        class="email-logo-light"
                        style="display:block;margin:0 auto;border:0;outline:none;width:${WORDMARK_WIDTH}px;height:auto;"
                      />
                      <img
                        src="${wordmarkDarkUrl}"
                        width="${WORDMARK_WIDTH}"
                        height="${WORDMARK_HEIGHT}"
                        alt="${escapeHtml(d.brand)}"
                        class="email-logo-dark"
                        style="display:none;margin:0 auto;border:0;outline:none;width:${WORDMARK_WIDTH}px;height:auto;"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 0 16px;font-family:${t.fontDisplay};font-size:22px;font-weight:600;line-height:1.3;text-align:center;">
                      ${heading}
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="text-align:center;">
                      ${bodyHtml}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px 0 16px;">
                      <div class="email-line" style="border-top:1px solid ${t.line};line-height:0;font-size:0;">&nbsp;</div>
                    </td>
                  </tr>
                  <!-- CASL: sender identification + physical address are mandatory on
                       every commercial message; unsubscribe only applies when unsubUrl
                       is given (see doc comment above). -->
                  <tr>
                    <td align="center" class="email-mute" style="font-size:12px;color:${t.mute};line-height:1.6;text-align:center;">
                      ${SENDER_IDENTITY.name}<br />
                      ${escapeHtml(address)}<br />
                      <a href="mailto:${SENDER_IDENTITY.email}" class="email-mute" style="color:${t.mute};">${SENDER_IDENTITY.email}</a>${
                        unsubUrl
                          ? `<br /><a href="${unsubUrl}" class="email-mute" style="color:${t.mute};">${d.mailUnsub}</a>`
                          : ''
                      }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <!--[if mso]>
          </td></tr></table>
          <![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/**
 * Plain-text companion to renderEmailShell. A text/plain part that omits the
 * CASL sender block is a non-compliant message in its own right, so the
 * footer is reproduced here rather than left to whatever an email client
 * falls back to when it can't render HTML.
 */
export function renderEmailText({
  heading,
  bodyText,
  unsubUrl,
  address,
}: {
  heading: string
  bodyText: string
  unsubUrl?: string
  address: string
}): string {
  const lines = [
    heading,
    '',
    bodyText,
    '',
    '—',
    SENDER_IDENTITY.name,
    address,
    SENDER_IDENTITY.email,
  ]
  if (unsubUrl) lines.push(unsubUrl)
  return lines.join('\n')
}

/**
 * Inline-styles the output of marked.parse() so a broadcast's paragraphs,
 * headings, links, lists and rules read as this brand rather than whatever
 * an email client's default stylesheet happens to be. Regex-based rather
 * than a DOM parser: broadcast.ts runs under plain Node with no DOM
 * available, and marked's output is a small, predictable tag set.
 */
export function styleMarkdownHtml(html: string): string {
  const t = EMAIL_THEME
  return html
    .replace(/<h2>/g, `<h2 class="email-ink" style="font-family:${t.fontDisplay};font-size:18px;font-weight:600;line-height:1.3;margin:24px 0 12px;color:${t.ink};text-align:center;">`)
    .replace(/<h3>/g, `<h3 class="email-ink" style="font-family:${t.fontDisplay};font-size:16px;font-weight:600;line-height:1.3;margin:20px 0 10px;color:${t.ink};text-align:center;">`)
    .replace(/<p>/g, `<p class="email-ink" style="font-size:15px;line-height:1.6;margin:0 0 16px;color:${t.ink};text-align:center;">`)
    .replace(/<li>/g, `<li class="email-ink" style="font-size:15px;line-height:1.6;color:${t.ink};">`)
    // The list itself centers as a block (inline-block + an auto side margin
    // has no anchor to center against in table-cell layout, so this rides on
    // the ancestor td's text-align:center instead); list items stay
    // left-aligned inside it — centering bullet text item-by-item reads as
    // broken, not intentional.
    .replace(/<ul>/g, `<ul style="display:inline-block;text-align:left;margin:0 0 16px;padding-left:20px;">`)
    .replace(/<ol>/g, `<ol style="display:inline-block;text-align:left;margin:0 0 16px;padding-left:20px;">`)
    .replace(/<a href=/g, `<a class="email-accent" style="color:${t.accentInk};" href=`)
    .replace(/<hr\s*\/?>/g, `<hr class="email-line" style="border:none;border-top:1px solid ${t.line};margin:24px 0;" />`)
    .replace(/<img /g, `<img style="width:100%;max-width:520px;display:block;margin:0 auto;border:0;" `)
}

/**
 * The confirmation email's body markup — pulled out so scripts/email-preview.ts
 * can render exactly what a real send would, instead of a hand-kept copy that
 * silently drifts from this one (it did, once, before this existed).
 */
export function confirmationBodyHtml(d: Dict, confirmUrl: string): string {
  const t = EMAIL_THEME
  return `
      <p class="email-ink" style="font-size:15px;line-height:1.6;margin:0 0 24px;color:${t.ink};text-align:center;">${d.mailBody}</p>
      <p style="margin:0 0 32px;text-align:center;">
        <a href="${confirmUrl}" class="email-btn" style="display:inline-block;background:${t.ink};color:${t.paper};text-decoration:none;padding:12px 22px;font-size:15px;">${d.mailCta}</a>
      </p>
      <p class="email-mute" style="font-size:13px;color:${t.mute};line-height:1.6;margin:0 0 24px;text-align:center;">${d.mailIgnore}</p>`
}

/**
 * Double opt-in confirmation. Not strictly required by CASL, but it produces a
 * second timestamped artifact proving consent and keeps the list clean — which
 * matters a lot on a domain with no sending reputation yet.
 */
export async function sendConfirmationEmail({
  apiKey,
  address,
  to,
  locale,
  siteUrl,
  token,
}: SendArgs): Promise<{ ok: boolean; error?: string }> {
  // No address configured: refuse before rendering anything, same shape as
  // the missing-RESEND_API_KEY refusal below — CASL requires a physical
  // mailing address in every commercial email, and there is no placeholder
  // to fall back to (src/lib/consent.ts).
  if (!senderAddressConfigured(address)) {
    return { ok: false, error: 'SENDER_ADDRESS is not configured' }
  }

  const d = UI[locale]
  const confirmUrl = `${siteUrl}/api/confirm?token=${token}`
  const unsubUrl = `${siteUrl}/api/unsubscribe?token=${token}`

  const html = renderEmailShell({
    locale,
    siteUrl,
    heading: d.mailHeading,
    preheader: d.mailBody,
    bodyHtml: confirmationBodyHtml(d, confirmUrl),
    unsubUrl,
    address,
  })
  const text = renderEmailText({
    heading: d.mailHeading,
    bodyText: `${d.mailBody}\n\n${d.mailCta}: ${confirmUrl}\n\n${d.mailIgnore}`,
    unsubUrl,
    address,
  })

  // No key configured: log the confirm URL so local dev is still usable, but
  // never claim the mail was sent. `import.meta.env` is undefined when
  // scripts/broadcast.ts imports this module under plain node, hence `?.`.
  if (!apiKey) {
    if (import.meta.env?.DEV) {
      console.log(`[email:dev] confirmation for ${to} -> ${confirmUrl}`)
    }
    return { ok: false, error: 'RESEND_API_KEY is not configured' }
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${SENDER_IDENTITY.name} <${SENDER_IDENTITY.email}>`,
      to: [to],
      subject: d.mailSubject,
      html,
      text,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>` },
    }),
  })

  if (!res.ok) {
    return { ok: false, error: `resend ${res.status}: ${await res.text()}` }
  }
  return { ok: true }
}
