/**
 * "Order edited" — Settings → Notifications → Customer notifications.
 *
 * Fires when a paid order is changed in the admin: a line added or removed, a
 * quantity corrected. Plausible at this scale — fixing a size someone picked
 * wrong *is* an order edit — and today the buyer's record of that correction
 * is stock Shopify.
 *
 * ## Context this expects
 *
 * The same order-level fields `order-confirmation.ts` uses, describing the
 * order's state *after* the edit.
 *
 * ## Why there is no "what changed" block
 *
 * Shopify does expose the edit's deltas to this template, but under names
 * its own variable reference doesn't pin down and which have moved between
 * API versions. A delta block built on a guessed field name fails in one of
 * two ways: it renders empty (the buyer is told their order changed and
 * shown nothing), or it renders the wrong set (the buyer is told the wrong
 * thing about what they are being charged for). Both are worse than the
 * alternative, which is unambiguous and needs no field this repo hasn't
 * already used in production: print the order as it now stands, and say
 * that's what it is.
 *
 * If the stock template turns out to carry a reliable delta collection,
 * adding it here is a small change — see shopify/notifications/README.md,
 * which lists it as an open question rather than a settled no.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine } from '../liquid.ts'
import { lineItemTable, totalsTable, ctaButton, paragraph, smallPrint } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Commande {{ order_name }} modifiée', 'Order {{ order_name }} updated')

const body = [
  paragraph(
    'Votre commande {{ order_name }} a été modifiée. La voici telle qu’elle est maintenant.',
    'Your order {{ order_name }} has been updated. Here is how it now stands.'
  ),
  lineItemTable('line_items', 'line'),
  totalsTable(),
  smallPrint(
    'Ce total remplace celui de votre confirmation précédente.',
    'This total replaces the one in your earlier confirmation.'
  ),
  paragraph(
    'Ce n’est pas ce que vous attendiez&nbsp;? Écrivez-nous et nous corrigerons.',
    'Not what you expected? Write to us and we will put it right.'
  ),
  ctaButton(t('Voir ma commande', 'View my order'), '{{ order_status_url }}'),
].join('\n')

export const orderEdited: NotificationTemplate = {
  file: 'order-edited',
  adminName: 'Order edited',
  subject: subjectLine('Votre commande {{ order_name }} a été modifiée', 'Your order {{ order_name }} was updated'),
  html: renderShell({
    heading,
    preheader: t('Votre commande {{ order_name }} a été modifiée.', 'Your order {{ order_name }} has been updated.'),
    bodyLiquid: body,
  }),
}
