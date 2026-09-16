/**
 * "Abandoned checkout" — the one marketing notification in this issue's
 * scope (#93's amendment: on, ~10h default delay, CASL's
 * implied-consent-via-inquiry). Context: `checkout` object at the top
 * level — line_items, billing_address — plus a top-level `url` (the
 * recovery link) and `checkout.customer_locale` for the locale prelude.
 * Carries an unsubscribe/opt-out link, unlike every transactional template
 * in this directory — see shell.ts's `includeUnsubscribe`.
 */
import { renderShell } from '../shell.ts'
import { t, subjectLine } from '../liquid.ts'
import { lineItemTable, ctaButton, paragraph } from '../blocks.ts'
import { UI } from '../../../src/i18n/ui.ts'
import type { NotificationTemplate } from './types.ts'

const heading = t('Votre panier vous attend', 'Your cart is waiting for you')

const body = [
  paragraph(
    '{% if billing_address.first_name %}Bonjour {{ billing_address.first_name }}. {% endif %}Vous avez laissé ceci dans votre panier.',
    '{% if billing_address.first_name %}Hi {{ billing_address.first_name }}. {% endif %}You left this in your cart.'
  ),
  lineItemTable('line_items', 'line'),
  paragraph(UI['fr-CA'].cartNoHold, UI['en-CA'].cartNoHold),
  ctaButton(t('Terminer ma commande', 'Complete my order'), '{{ url }}'),
].join('\n')

export const abandonedCheckout: NotificationTemplate = {
  file: 'abandoned-checkout',
  adminName: 'Abandoned checkout',
  subject: subjectLine('Votre panier vous attend', 'Your cart is waiting for you'),
  html: renderShell({
    heading,
    preheader: t('Vous avez laissé quelque chose dans votre panier.', 'You left something in your cart.'),
    bodyLiquid: body,
    includeUnsubscribe: true,
  }),
}
