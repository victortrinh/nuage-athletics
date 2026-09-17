/**
 * "Order confirmation" — Settings → Notifications → Customer notifications.
 * Context: order-level fields at the top level (order_name, email,
 * line_items, subtotal_price, total_price, shipping_address,
 * billing_address, shipping_method, tax_lines, total_discounts,
 * order_status_url, customer) plus order.customer_locale for the locale
 * prelude — Shopify exposes both the flat fields and the `order` object on
 * this template.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine } from '../liquid.ts'
import { lineItemTable, totalsTable, addressesBlock, ctaButton, paragraph } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Commande {{ order_name }} confirmée', 'Order {{ order_name }} confirmed')

const body = [
  paragraph(
    'Merci pour votre commande, {{ customer.first_name }}.',
    'Thanks for your order, {{ customer.first_name }}.'
  ),
  lineItemTable('line_items', 'line'),
  totalsTable(),
  addressesBlock(),
  paragraph(
    `Détails de livraison sur <a href="https://nuageathletics.com/livraison/">nuageathletics.com/livraison</a>.`,
    `Delivery details at <a href="https://nuageathletics.com/en/shipping/">nuageathletics.com/en/shipping</a>.`
  ),
  paragraph(
    `Un changement à faire avant l'expédition&nbsp;? Écrivez-nous — voir <a href="https://nuageathletics.com/retours/">notre politique</a>.`,
    `Need a change before it ships? Write to us — see <a href="https://nuageathletics.com/en/returns/">our policy</a>.`
  ),
  ctaButton(t('Voir ma commande', 'View my order'), '{{ order_status_url }}'),
].join('\n')

export const orderConfirmation: NotificationTemplate = {
  file: 'order-confirmation',
  adminName: 'Order confirmation',
  subject: subjectLine('Confirmation de votre commande {{ order_name }}', 'Your order {{ order_name }} is confirmed'),
  html: renderShell({
    heading,
    preheader: t('Votre commande {{ order_name }} est confirmée.', 'Your order {{ order_name }} is confirmed.'),
    bodyLiquid: body,
  }),
}
