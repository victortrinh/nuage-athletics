/**
 * "Delivered" — same `fulfillment` context, sent once the carrier reports
 * delivery.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine } from '../liquid.ts'
import { ctaButton, paragraph } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Livré', 'Delivered')

const body = [
  paragraph(
    'Votre commande {{ order_name }} a été livrée.',
    'Your order {{ order_name }} has been delivered.'
  ),
  paragraph(
    "Un problème avec ce qui est arrivé&nbsp;? Écrivez-nous — voir <a href=\"https://nuageathletics.com/retours/\">notre politique</a>.",
    'A problem with what arrived? Write to us — see <a href="https://nuageathletics.com/en/returns/">our policy</a>.'
  ),
  ctaButton(t('Voir ma commande', 'View my order'), '{{ order_status_url }}'),
].join('\n')

export const shipmentDelivered: NotificationTemplate = {
  file: 'shipment-delivered',
  adminName: 'Delivered',
  subject: subjectLine('Livré — commande {{ order_name }}', 'Delivered — order {{ order_name }}'),
  html: renderShell({
    heading,
    preheader: t('Votre commande a été livrée.', 'Your order has been delivered.'),
    bodyLiquid: body,
  }),
}
