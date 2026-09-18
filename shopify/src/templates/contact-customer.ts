/**
 * "Contact customer" — Settings → Notifications → Customer notifications.
 *
 * The template Shopify uses whenever a message is sent to a customer from the
 * admin (an order's "Contact customer" action). It is the highest-frequency
 * unbranded surface left after #91: a one-person shop answering "where is my
 * order?" sends this, and today it arrives as Shopify's stock white template
 * minutes after a branded confirmation landed in the same thread.
 *
 * ## Context this expects
 *
 * `custom_message` — what was typed in the admin dialog. An order may or may
 * not be in context: the same notification is reachable from an order (where
 * `order_name` resolves) and from a customer record (where it does not), so
 * the order reference below is guarded rather than assumed.
 *
 * ## Why it ships no subject template
 *
 * The admin dialog has its own Subject field, typed per message. A generated
 * subject would either be overwritten by it or quietly replace what was
 * typed. `NotificationTemplate.subject` is optional for exactly this one
 * case — see that type, and the runbook's instruction to leave Shopify's
 * stock subject template alone.
 *
 * ## Why the body is almost nothing
 *
 * Everything the recipient reads here was written by a human thirty seconds
 * earlier. The template's whole job is to put the brand's frame around it
 * and stay out of the way — no greeting (the typed message has its own), no
 * CTA (there is nothing generic to link to), no order table (the message is
 * about whatever it is about). `newline_to_br` is the one thing done to the
 * text, so a message typed as three paragraphs arrives as three paragraphs.
 */
import { renderShell } from '../shell.ts'
import { t } from '../liquid.ts'
import { rawParagraph, smallPrint } from '../blocks.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Un message de Nuage Athletics', 'A message from Nuage Athletics')

const body = [
  rawParagraph('{{ custom_message | newline_to_br }}'),
  // Guarded, not assumed: this notification is reachable from a customer
  // record as well as from an order, and `order_name` is empty there.
  // `order_name`, not `order.name`, matching every other order-family
  // template in this directory.
  `{% if order_name %}${smallPrint(
    'Au sujet de la commande {{ order_name }}.',
    'Regarding order {{ order_name }}.'
  )}{% endif %}`,
].join('\n')

export const contactCustomer: NotificationTemplate = {
  file: 'contact-customer',
  adminName: 'Contact customer',
  html: renderShell({
    heading,
    preheader: t('Un message au sujet de votre commande.', 'A message about your order.'),
    bodyLiquid: body,
  }),
}
