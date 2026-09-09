import type { Locale } from '../i18n/config.ts'
import { UI } from '../i18n/ui.ts'
import { SENDER_IDENTITY } from './consent.ts'

export const RESEND_ENDPOINT = 'https://api.resend.com/emails'

interface SendArgs {
  apiKey: string | undefined
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

/** Absolute path to the committed wordmark PNG. See scripts/email-wordmark.mjs. */
export const WORDMARK_PATH = '/img/wordmark-email.png'
/** Displayed width; the source asset (320x79, scripts/email-wordmark.mjs) is
 * more than 2x this, so it stays sharp at retina. Small on purpose — this
 * sits inside a padded card now, not full-width across the message. */
const WORDMARK_WIDTH = 120
const WORDMARK_HEIGHT = 29

/**
 * The outer backdrop around the message card, standing in for the site's own
 * background (Sky.astro's WebGL canvas / the `sky-fallback` utility in
 * global.css) — email can't run either. This is not a token copy the way
 * EMAIL_THEME is: it's a deliberately simplified approximation, a couple of
 * soft grey masses over a light wash in the same hue sky-fallback uses
 * (rgba(158,158,158,...) on near-white), because email clients that ignore
 * background-image entirely (Outlook desktop chief among them) still need
 * *something* — hence the solid OUTER_BG color as the real fallback, with
 * the gradient layered on as a progressive enhancement for clients that
 * render it (Apple Mail, iOS Mail, Gmail's webmail and app).
 */
const OUTER_BG = '#e8e8e6'
const OUTER_BG_IMAGE = [
  'radial-gradient(46% 38% at 18% 10%, rgba(158,158,158,0.16) 0%, rgba(158,158,158,0) 100%)',
  'radial-gradient(50% 40% at 84% 6%, rgba(158,158,158,0.14) 0%, rgba(158,158,158,0) 100%)',
  'radial-gradient(60% 46% at 50% 100%, rgba(158,158,158,0.18) 0%, rgba(158,158,158,0) 100%)',
  'linear-gradient(to bottom, #eeeeec 0%, #e4e4e2 100%)',
].join(', ')

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
 * automatically. Order confirmations are transactional, not commercial, so
 * CASL doesn't require an unsubscribe link on them — unsubUrl is optional and
 * that line is simply omitted when there's nothing to unsubscribe from.
 *
 * Table-based layout, not divs: Outlook's Word rendering engine ignores
 * max-width on a div but honours a fixed-width <table>, and the MSO
 * conditional comment below is what keeps the column at 520px there instead
 * of full-bleed. `color-scheme: light only` stops Gmail/Apple Mail from
 * auto-inverting a site that has no dark mode of its own.
 *
 * The message itself sits in a paper card — border, not shadow, matching the
 * site's own "no shadows" rule — floated on OUTER_BG, the email's stand-in
 * for the site's sky background. `bgcolor` attributes ride alongside the CSS
 * on both the outer wrapper and the card because Outlook's Word engine
 * ignores `background`/`background-color` in `style=` but does honour the
 * HTML attribute.
 */
export function renderEmailShell({
  locale,
  heading,
  bodyHtml,
  unsubUrl,
  siteUrl,
  preheader,
}: {
  locale: Locale
  heading: string
  bodyHtml: string
  unsubUrl?: string
  siteUrl: string
  preheader?: string
}): string {
  const d = UI[locale]
  const t = EMAIL_THEME
  const wordmarkUrl = `${siteUrl}${WORDMARK_PATH}`

  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
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
  </head>
  <body style="margin:0;padding:0;background-color:${OUTER_BG};">
    ${
      preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>`
        : ''
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${OUTER_BG}" style="background-color:${OUTER_BG};background-image:${OUTER_BG_IMAGE};background-repeat:no-repeat;">
      <tr>
        <td align="center" style="padding:48px 16px;">
          <!--[if mso]>
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td>
          <![endif]-->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.paper}" style="max-width:520px;background-color:${t.paper};border:1px solid ${t.line};">
            <tr>
              <td style="padding:40px 32px;font-family:${t.fontSans};color:${t.ink};">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:0 0 28px;">
                      <img
                        src="${wordmarkUrl}"
                        width="${WORDMARK_WIDTH}"
                        height="${WORDMARK_HEIGHT}"
                        alt="${escapeHtml(d.brand)}"
                        style="display:block;border:0;outline:none;width:${WORDMARK_WIDTH}px;height:auto;"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 16px;font-family:${t.fontDisplay};font-size:22px;font-weight:600;line-height:1.3;">
                      ${heading}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      ${bodyHtml}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px 0 16px;">
                      <div style="border-top:1px solid ${t.line};line-height:0;font-size:0;">&nbsp;</div>
                    </td>
                  </tr>
                  <!-- CASL: sender identification + physical address are mandatory on
                       every commercial message; unsubscribe only applies when unsubUrl
                       is given (see doc comment above). -->
                  <tr>
                    <td style="font-size:12px;color:${t.mute};line-height:1.6;">
                      ${SENDER_IDENTITY.name}<br />
                      ${escapeHtml(SENDER_IDENTITY.address)}<br />
                      <a href="mailto:${SENDER_IDENTITY.email}" style="color:${t.mute};">${SENDER_IDENTITY.email}</a>${
                        unsubUrl
                          ? `<br /><a href="${unsubUrl}" style="color:${t.mute};">${d.mailUnsub}</a>`
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
}: {
  heading: string
  bodyText: string
  unsubUrl?: string
}): string {
  const lines = [
    heading,
    '',
    bodyText,
    '',
    '—',
    SENDER_IDENTITY.name,
    SENDER_IDENTITY.address,
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
    .replace(/<h2>/g, `<h2 style="font-family:${t.fontDisplay};font-size:18px;font-weight:600;line-height:1.3;margin:24px 0 12px;color:${t.ink};">`)
    .replace(/<h3>/g, `<h3 style="font-family:${t.fontDisplay};font-size:16px;font-weight:600;line-height:1.3;margin:20px 0 10px;color:${t.ink};">`)
    .replace(/<p>/g, `<p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:${t.ink};">`)
    .replace(/<li>/g, `<li style="font-size:15px;line-height:1.6;color:${t.ink};">`)
    .replace(/<ul>/g, `<ul style="margin:0 0 16px;padding-left:20px;">`)
    .replace(/<ol>/g, `<ol style="margin:0 0 16px;padding-left:20px;">`)
    .replace(/<a href=/g, `<a style="color:${t.accentInk};" href=`)
    .replace(/<hr\s*\/?>/g, `<hr style="border:none;border-top:1px solid ${t.line};margin:24px 0;" />`)
    .replace(/<img /g, `<img style="width:100%;max-width:520px;display:block;border:0;" `)
}

/**
 * Double opt-in confirmation. Not strictly required by CASL, but it produces a
 * second timestamped artifact proving consent and keeps the list clean — which
 * matters a lot on a domain with no sending reputation yet.
 */
export async function sendConfirmationEmail({
  apiKey,
  to,
  locale,
  siteUrl,
  token,
}: SendArgs): Promise<{ ok: boolean; error?: string }> {
  const d = UI[locale]
  const t = EMAIL_THEME
  const confirmUrl = `${siteUrl}/api/confirm?token=${token}`
  const unsubUrl = `${siteUrl}/api/unsubscribe?token=${token}`

  const html = renderEmailShell({
    locale,
    siteUrl,
    heading: d.mailHeading,
    preheader: d.mailBody,
    bodyHtml: `
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:${t.ink};">${d.mailBody}</p>
      <p style="margin:0 0 32px;">
        <a href="${confirmUrl}" style="display:inline-block;background:${t.ink};color:${t.paper};text-decoration:none;padding:12px 22px;font-size:15px;">${d.mailCta}</a>
      </p>
      <p style="font-size:13px;color:${t.mute};line-height:1.6;margin:0 0 24px;">${d.mailIgnore}</p>`,
    unsubUrl,
  })
  const text = renderEmailText({
    heading: d.mailHeading,
    bodyText: `${d.mailBody}\n\n${d.mailCta}: ${confirmUrl}\n\n${d.mailIgnore}`,
    unsubUrl,
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

interface OrderEmailArgs {
  apiKey: string | undefined
  to: string
  locale: Locale
  siteUrl: string
  amountTotal: number
  currency: string
}

/**
 * Order confirmation — transactional, sent from the Stripe webhook once a
 * payment actually succeeds. Bill 96 requires this in the buyer's language
 * just as much as any marketing page; it isn't exempt just for being a
 * receipt.
 */
export async function sendOrderConfirmationEmail({
  apiKey,
  to,
  locale,
  siteUrl,
  amountTotal,
  currency,
}: OrderEmailArgs): Promise<{ ok: boolean; error?: string }> {
  const d = UI[locale]
  const t = EMAIL_THEME
  const total = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amountTotal / 100
  )

  const html = renderEmailShell({
    locale,
    siteUrl,
    heading: d.orderConfirmedTitle,
    preheader: d.orderConfirmedBody,
    bodyHtml: `
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:${t.ink};">${d.orderConfirmedBody}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;font-weight:600;color:${t.ink};">${total}</p>`,
  })
  const text = renderEmailText({
    heading: d.orderConfirmedTitle,
    bodyText: `${d.orderConfirmedBody}\n\n${total}`,
  })

  // Same rule as the confirmation email: log in dev, never report a send that
  // did not happen. The Stripe webhook logs this and still returns 200, so a
  // missing receipt cannot trigger a retry and reprocess the order.
  if (!apiKey) {
    if (import.meta.env?.DEV) {
      console.log(`[email:dev] order confirmation for ${to} -> ${total}`)
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
      subject: d.orderConfirmedTitle,
      html,
      text,
    }),
  })

  if (!res.ok) {
    return { ok: false, error: `resend ${res.status}: ${await res.text()}` }
  }
  return { ok: true }
}
