/**
 * "Shipping update" — sent when a carrier tracking event changes status
 * (e.g. an exception or a delay) after shipping confirmation already went
 * out. Context: same `fulfillment` object as shipping-confirmation, plus
 * a `fulfillment_event` with the specific status change
 * (fulfillment_event.status, .message, .city, .happened_at) — verify this
 * shape against the stock template before pasting (see README); Shopify's
 * own variable docs don't cover this notification in detail.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine } from '../liquid.ts'
import { trackingBlock, ctaButton, paragraph, smallPrint } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Mise à jour de livraison — {{ order_name }}', 'Shipping update — {{ order_name }}')

const body = [
  paragraph(
    "Le statut de livraison de votre commande a changé.",
    'Your delivery status has changed.'
  ),
  `{% if fulfillment_event.message %}${smallPrint('{{ fulfillment_event.message }}', '{{ fulfillment_event.message }}')}{% endif %}`,
  trackingBlock(),
  ctaButton(t('Suivre ma commande', 'Track my order'), '{{ order_status_url }}'),
].join('\n')

export const shippingUpdate: NotificationTemplate = {
  file: 'shipping-update',
  adminName: 'Shipping update',
  subject: subjectLine('Mise à jour de livraison — {{ order_name }}', 'Shipping update — {{ order_name }}'),
  html: renderShell({
    heading,
    preheader: t('Le statut de votre livraison a changé.', 'Your delivery status has changed.'),
    bodyLiquid: body,
  }),
}
