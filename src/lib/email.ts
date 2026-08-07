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
 * Shared branded shell for every outbound email. CASL requires sender
 * identification, a physical mailing address, and an unsubscribe mechanism in
 * every *commercial* email — this is the one place that renders all three, so
 * every commercial call site (confirmation emails, broadcasts) gets them
 * automatically. Order confirmations are transactional, not commercial, so
 * CASL doesn't require an unsubscribe link on them — unsubUrl is optional and
 * that line is simply omitted when there's nothing to unsubscribe from.
 */
export function renderEmailShell({
  locale,
  heading,
  bodyHtml,
  unsubUrl,
}: {
  locale: Locale
  heading: string
  bodyHtml: string
  unsubUrl?: string
}): string {
  const d = UI[locale]
  return `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;padding:32px;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0a0a0a;">
    <div style="max-width:520px;margin:0 auto;">
      <p style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;margin:0 0 32px;">${d.brand}</p>
      <h1 style="font-size:22px;font-weight:600;margin:0 0 16px;">${heading}</h1>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:32px 0 16px;" />
      <!-- CASL: sender identification + physical address are mandatory on
           every commercial message; unsubscribe only applies when unsubUrl
           is given (see doc comment above). -->
      <p style="font-size:12px;color:#888;line-height:1.6;margin:0;">
        ${SENDER_IDENTITY.name}<br />
        ${SENDER_IDENTITY.address}<br />
        <a href="mailto:${SENDER_IDENTITY.email}" style="color:#888;">${SENDER_IDENTITY.email}</a>${
          unsubUrl
            ? `<br /><a href="${unsubUrl}" style="color:#888;">${d.mailUnsub}</a>`
            : ''
        }
      </p>
    </div>
  </body>
</html>`
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
  const confirmUrl = `${siteUrl}/api/confirm?token=${token}`
  const unsubUrl = `${siteUrl}/api/unsubscribe?token=${token}`

  const html = renderEmailShell({
    locale,
    heading: d.mailHeading,
    bodyHtml: `
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">${d.mailBody}</p>
      <p style="margin:0 0 32px;">
        <a href="${confirmUrl}" style="display:inline-block;background:#0a0a0a;color:#fafafa;text-decoration:none;padding:12px 22px;border-radius:4px;font-size:15px;">${d.mailCta}</a>
      </p>
      <p style="font-size:13px;color:#666;line-height:1.6;margin:0 0 24px;">${d.mailIgnore}</p>`,
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
  amountTotal,
  currency,
}: OrderEmailArgs): Promise<{ ok: boolean; error?: string }> {
  const d = UI[locale]
  const total = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amountTotal / 100
  )

  const html = renderEmailShell({
    locale,
    heading: d.orderConfirmedTitle,
    bodyHtml: `
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">${d.orderConfirmedBody}</p>
      <p style="font-size:15px;line-height:1.6;margin:0 0 24px;font-weight:600;">${total}</p>`,
  })

  if (!apiKey) {
    console.log(`[email:dev] order confirmation for ${to} -> ${total}`)
    return { ok: true }
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
    }),
  })

  if (!res.ok) {
    return { ok: false, error: `resend ${res.status}: ${await res.text()}` }
  }
  return { ok: true }
}
