/**
 * "Order invoice" — Settings → Notifications → Customer notifications.
 *
 * Sent when an invoice is sent from the admin for an order that hasn't been
 * paid: an order keyed in by hand, a replacement, a friend's order taken
 * outside the site. #91 skipped it because none of those come through the
 * cart → hosted-checkout path, which is also exactly why it needs branding —
 * it is the confirmation email for every order that *didn't* come from the
 * site, so it is the only Nuage email those buyers ever see.
 *
 * ## Context this expects
 *
 * Order-level fields at the top level, the same set `order-confirmation.ts`
 * uses (`order_name`, `line_items`, `subtotal_price`, `total_discounts`,
 * `shipping_method`, `tax_lines`, `total_price`, `customer`) plus
 * `custom_message` (optional note typed in the send-invoice dialog).
 *
 * ⚠️ **The pay link is the field to verify.** This uses `{{ invoice_url }}`,
 * guarded, because an unpaid order's payment link is not
 * `order_status_url` and Shopify's notification variable reference does not
 * document it consistently across API versions — it may be `invoice_url`,
 * `order.invoice_url`, or exposed only on the draft-order variant of this
 * template. Read the stock template's own Liquid before pasting and fix the
 * source here if it differs; the guard means a wrong name renders no button
 * rather than a dead one, but an invoice with no way to pay it is still a
 * broken invoice.
 *
 * ⚠️ Confirm whether the admin lists a separate **"Draft order invoice"**
 * slot. If it does, it is a second notification with its own stock template
 * and this file does not cover it — a second template here, not the same
 * file pasted twice.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine } from '../liquid.ts'
import { lineItemTable, totalsTable, ctaButton, paragraph, rawParagraph } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Facture pour la commande {{ order_name }}', 'Invoice for order {{ order_name }}')

const body = [
  paragraph(
    'Bonjour {{ customer.first_name }}, voici la facture pour votre commande {{ order_name }}.',
    'Hi {{ customer.first_name }}, here is the invoice for your order {{ order_name }}.'
  ),
  // The note typed in the send-invoice dialog, when there is one. Send-time
  // content in its author's own words — see rawParagraph.
  `{% if custom_message %}${rawParagraph('{{ custom_message | newline_to_br }}')}{% endif %}`,
  lineItemTable('line_items', 'line'),
  totalsTable(),
  `{% if invoice_url %}${ctaButton(t('Payer ma commande', 'Pay for my order'), '{{ invoice_url }}')}{% endif %}`,
].join('\n')

export const orderInvoice: NotificationTemplate = {
  file: 'order-invoice',
  adminName: 'Order invoice',
  subject: subjectLine('Facture pour votre commande {{ order_name }}', 'Invoice for your order {{ order_name }}'),
  html: renderShell({
    heading,
    preheader: t('Votre facture pour la commande {{ order_name }}.', 'Your invoice for order {{ order_name }}.'),
    bodyLiquid: body,
  }),
}
