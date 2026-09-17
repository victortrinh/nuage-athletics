/**
 * "Order cancelled" — same order-level context as order-confirmation, plus
 * `cancel_reason` (a code, not customer-facing wording — not rendered
 * here) and `cancelled_at`.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine } from '../liquid.ts'
import { lineItemTable, paragraph } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Commande {{ order_name }} annulée', 'Order {{ order_name }} cancelled')

const body = [
  paragraph(
    'Votre commande {{ order_name }} a été annulée.',
    'Your order {{ order_name }} has been cancelled.'
  ),
  lineItemTable('line_items', 'line'),
  paragraph(
    "Si un remboursement est dû, il est traité séparément — vous recevrez un courriel une fois le remboursement effectué.",
    'If a refund is due, it is processed separately — you will get an email once it has gone through.'
  ),
].join('\n')

export const orderCancelled: NotificationTemplate = {
  file: 'order-cancelled',
  adminName: 'Order cancelled',
  subject: subjectLine('Commande {{ order_name }} annulée', 'Order {{ order_name }} cancelled'),
  html: renderShell({
    heading,
    preheader: t('Votre commande a été annulée.', 'Your order has been cancelled.'),
    bodyLiquid: body,
  }),
}
