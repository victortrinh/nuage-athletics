/**
 * "Order refund" — context: a `refund` (or `refund_line_items` at the top
 * level, depending on Shopify's current default — verify against the
 * stock template, see README) with `.line_item`, `.quantity`, `.subtotal`
 * per line, plus a top-level `amount` for the total refunded.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine, moneyWithCurrency } from '../liquid.ts'
import { lineItemTable, paragraph } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Remboursement — commande {{ order_name }}', 'Refund — order {{ order_name }}')

const body = [
  paragraph(
    `Un remboursement de ${moneyWithCurrency('amount')} a été émis pour votre commande {{ order_name }}.`,
    `A refund of ${moneyWithCurrency('amount')} has been issued for your order {{ order_name }}.`
  ),
  lineItemTable('refund_line_items', 'line.line_item', 'line.subtotal'),
  paragraph(
    'Comptez quelques jours ouvrables pour que le remboursement apparaisse sur votre relevé.',
    'Allow a few business days for the refund to appear on your statement.'
  ),
].join('\n')

export const orderRefund: NotificationTemplate = {
  file: 'order-refund',
  adminName: 'Order refund',
  subject: subjectLine('Remboursement — commande {{ order_name }}', 'Refund — order {{ order_name }}'),
  html: renderShell({
    heading,
    preheader: t('Un remboursement a été émis.', 'A refund has been issued.'),
    bodyLiquid: body,
  }),
}
