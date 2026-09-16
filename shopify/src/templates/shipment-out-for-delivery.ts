/**
 * "Out for delivery" — same `fulfillment` context as shipping-confirmation,
 * sent once the carrier reports the package is on today's delivery route.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine } from '../liquid.ts'
import { trackingBlock, ctaButton, paragraph } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Votre colis arrive aujourd’hui', 'Your package arrives today')

const body = [
  paragraph(
    'Votre commande {{ order_name }} est en livraison.',
    'Your order {{ order_name }} is out for delivery.'
  ),
  trackingBlock(),
  ctaButton(t('Suivre ma commande', 'Track my order'), '{{ order_status_url }}'),
].join('\n')

export const shipmentOutForDelivery: NotificationTemplate = {
  file: 'shipment-out-for-delivery',
  adminName: 'Out for delivery',
  subject: subjectLine('Votre colis arrive aujourd’hui', 'Your package arrives today'),
  html: renderShell({
    heading,
    preheader: t('Livraison prévue aujourd’hui.', 'Delivery expected today.'),
    bodyLiquid: body,
  }),
}
