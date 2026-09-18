/**
 * Body fragments shared across the notification templates — line-item
 * tables, totals, addresses, tracking, the CTA button. Same styling tokens
 * as shell.ts/src/lib/email.ts's confirmationBodyHtml, so a paragraph here
 * reads identically to one in the Resend-sent mail. Every colour is a
 * literal hex inlined on the element, same as src/lib/email.ts — the email
 * is dark in every client by design (see EMAIL_THEME's doc comment), so
 * there's no light/dark toggle and no class needed to drive one; `email-btn`
 * is the one class in this whole shell, reserved for the CTA button's
 * `[data-ogsc]`/`[data-ogsb]` Outlook-auto-invert defense (shell.ts).
 *
 * Shopify's own variable set differs by notification family and isn't fully
 * documented in one place (Shopify's own "Notifications variables
 * reference" omits several fields these blocks use) — every block's doc
 * comment says which Liquid object it expects, and
 * shopify/notifications/README.md has the step to double-check each one
 * against the *stock* template for that notification before pasting, which
 * is the only reliable ground truth Shopify gives us.
 */
import { EMAIL_THEME } from '../../src/lib/email.ts'
import { t, money, moneyWithCurrency, isoDate } from './liquid.ts'

const theme = EMAIL_THEME

const P = (body: string) =>
  `<p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:${theme.ink};text-align:left;">${body}</p>`

const SMALL = (body: string) =>
  `<p style="font-size:13px;color:${theme.mute};line-height:1.6;margin:0 0 16px;text-align:left;">${body}</p>`

/**
 * Renders a Liquid `{% for %}` over a line-item collection. `loopVar` is the
 * source expression (`line_items` on order mail; `fulfillment.fulfillment_line_items`
 * on shipping mail, where each entry wraps the real item under `.line_item`)
 * and `itemPath` is how to reach the line item's own fields from inside the
 * loop (`line` vs `line.line_item`).
 */
export function lineItemTable(loopVar: string, itemPath: string, priceExpr = `${itemPath}.final_line_price`): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
  {% for line in ${loopVar} %}
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid ${theme.line};font-size:14px;line-height:1.5;color:${theme.ink};text-align:left;vertical-align:top;">
      {{ ${itemPath}.title }}{% if ${itemPath}.variant_title %}<br /><span style="font-size:12px;color:${theme.mute};">{{ ${itemPath}.variant_title }}</span>{% endif %}
    </td>
    <td style="padding:8px 0;border-bottom:1px solid ${theme.line};font-size:14px;color:${theme.mute};text-align:center;white-space:nowrap;">× {{ line.quantity }}</td>
    <td style="padding:8px 0;border-bottom:1px solid ${theme.line};font-size:14px;color:${theme.ink};text-align:right;white-space:nowrap;">${money(priceExpr)}</td>
  </tr>
  {% endfor %}
</table>`
}

/**
 * Order-level totals. Expects `subtotal_price`, `total_discounts`,
 * `shipping_method`, `tax_lines`, `total_price` on the enclosing object
 * (`order` context on order/cancel/refund mail). The tax loop renders
 * nothing for drop one (ADR-0002 — no tax registration) but stays so a
 * future registration doesn't need a template edit.
 */
export function totalsTable(): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 0;font-size:13px;color:${theme.mute};text-align:left;">${label}</td><td style="padding:4px 0;font-size:13px;color:${theme.ink};text-align:right;">${value}</td></tr>`
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  ${row(t('Sous-total', 'Subtotal'), money('subtotal_price'))}
  {% if total_discounts != 0 %}${row(t('Rabais', 'Discount'), '-' + money('total_discounts'))}{% endif %}
  ${row(t('Livraison', 'Shipping'), money('shipping_method.price'))}
  {% for tax_line in tax_lines %}${row(`{{ tax_line.title }}`, money('tax_line.price'))}{% endfor %}
  <tr><td style="padding:12px 0 0;border-top:1px solid ${theme.line};font-size:15px;font-weight:600;color:${theme.ink};text-align:left;">${t('Total', 'Total')}</td><td style="padding:12px 0 0;border-top:1px solid ${theme.line};font-size:15px;font-weight:600;color:${theme.ink};text-align:right;">${moneyWithCurrency('total_price')}</td></tr>
</table>`
}

/** Shipping + billing address block. Expects `shipping_address`,
 * `billing_address` on the enclosing `order` context. `format_address`
 * returns Shopify's own pre-formatted multi-line HTML. */
export function addressesBlock(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
  <tr>
    <td width="50%" style="padding:0 8px 0 0;vertical-align:top;font-size:13px;line-height:1.6;color:${theme.mute};text-align:left;">
      <strong style="color:${theme.ink};">${t('Livraison', 'Shipping')}</strong><br />
      {{ shipping_address | format_address }}
    </td>
    <td width="50%" style="padding:0 0 0 8px;vertical-align:top;font-size:13px;line-height:1.6;color:${theme.mute};text-align:left;">
      <strong style="color:${theme.ink};">${t('Facturation', 'Billing')}</strong><br />
      {{ billing_address | format_address }}
    </td>
  </tr>
</table>`
}

/** Tracking block for the fulfillment-family templates. Expects
 * `fulfillment.tracking_company`, `.tracking_number`, `.tracking_url`,
 * `.estimated_delivery_at` on the enclosing context. All four are optional
 * on a real fulfillment (a merchant can mark one shipped with no carrier
 * info), hence the guards. */
export function trackingBlock(): string {
  const company = '{{ fulfillment.tracking_company }}'
  const trackingLink = `<a href="{{ fulfillment.tracking_url }}" style="color:${theme.accentInk};">{{ fulfillment.tracking_number }}</a>`
  const trackingLine = t(
    `Numéro de suivi (${company})&nbsp;: ${trackingLink}`,
    `Tracking number (${company}): ${trackingLink}`
  )
  const deliveryLine = t(
    `Livraison estimée le ${isoDate('fulfillment.estimated_delivery_at')}.`,
    `Estimated delivery ${isoDate('fulfillment.estimated_delivery_at')}.`
  )
  return `{% if fulfillment.tracking_number %}
${SMALL(trackingLine)}
{% endif %}
{% if fulfillment.estimated_delivery_at %}
${SMALL(deliveryLine)}
{% endif %}`
}

/** The single call-to-action button, styled exactly like
 * src/lib/email.ts's `.email-btn` (ink on paper, no radius) — `email-btn` is
 * the one class this shell uses, reserved for shell.ts's
 * `[data-ogsc]`/`[data-ogsb]` Outlook-auto-invert defense. */
export function ctaButton(label: string, urlExpr: string): string {
  return `<p style="margin:0 0 24px;text-align:left;"><a href="${urlExpr}" class="email-btn" style="display:inline-block;background:${theme.ink};color:${theme.paper};text-decoration:none;padding:12px 22px;font-size:15px;">${label}</a></p>`
}

/** Plain paragraph, left-aligned to match the order-detail body (unlike
 * src/lib/email.ts's centered confirmation body — a receipt reads as a
 * document, not an announcement). */
export function paragraph(fr: string, en: string): string {
  return P(t(fr, en))
}

/** Muted secondary paragraph — same role as src/lib/email.ts's mailIgnore
 * line. */
export function smallPrint(fr: string, en: string): string {
  return SMALL(t(fr, en))
}

/**
 * A paragraph whose content is not a translatable string.
 *
 * `paragraph()` takes both locales because every string this codebase writes
 * must exist in both (non-negotiable #2, and `t()`'s signature enforces it).
 * That rule is about copy *we* author. It does not describe a Liquid
 * interpolation whose value is supplied at send time and is already in
 * whatever language its author used — `{{ custom_message }}`, typed into the
 * admin by a human addressing one customer. Running that through `t()` would
 * emit the identical string in both branches, which reads like a translation
 * that was never done rather than content that has no translation to do.
 *
 * Use this only for that: interpolated, send-time content. Anything we wrote
 * goes through `paragraph()`.
 */
export function rawParagraph(html: string): string {
  return P(html)
}
