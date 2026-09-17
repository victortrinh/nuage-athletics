/**
 * "Shipping confirmation" — sent once per fulfillment. Context: a
 * `fulfillment` object (tracking_company/number/url,
 * estimated_delivery_at, fulfillment_line_items — each entry wraps the
 * real line item under `.line_item`), plus order-level order_name and
 * order_status_url.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine } from '../liquid.ts'
import { lineItemTable, trackingBlock, ctaButton, paragraph } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Votre commande {{ order_name }} est en route', 'Your order {{ order_name }} is on its way')

const body = [
  paragraph(
    'Voici ce qui a été expédié.',
    "Here's what shipped."
  ),
  lineItemTable('fulfillment.fulfillment_line_items', 'line.line_item'),
  trackingBlock(),
  ctaButton(t('Suivre ma commande', 'Track my order'), '{{ order_status_url }}'),
].join('\n')

export const shippingConfirmation: NotificationTemplate = {
  file: 'shipping-confirmation',
  adminName: 'Shipping confirmation',
  subject: subjectLine('Votre commande {{ order_name }} est en route', 'Your order {{ order_name }} is on its way'),
  html: renderShell({
    heading,
    preheader: t('Votre colis est en route.', 'Your package is on its way.'),
    bodyLiquid: body,
  }),
}
