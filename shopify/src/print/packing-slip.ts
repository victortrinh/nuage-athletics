/**
 * "Packing slip" — Settings → Shipping and delivery → Packing slips → Edit
 * template. The only branded thing that physically arrives with the garment
 * (#110).
 *
 * ## Context this expects
 *
 * Shopify's packing slip renders against the *fulfillment* being packed, not
 * the whole order: `line_items` is top level and holds the items in this
 * shipment, while order-level facts hang off `order` (`order.name`,
 * `order.created_at`, `order.shipping_address`, `order.note`,
 * `order.customer_locale`). `shop.address.summary` is the store address, the
 * same value the notification footers print.
 *
 * ⚠️ Shopify documents the packing slip's variables even less thoroughly
 * than the notification ones, and the stock template loaded in the admin is
 * the only reliable ground truth. shopify/print/README.md has the
 * field-by-field check to run before pasting this.
 *
 * ## Why there are no prices on it
 *
 * Shopify's own stock slip carries none either, and the reasons hold here:
 * the buyer already has a priced confirmation email they can retain, the
 * slip's job is to say what is in the box so it can be checked against what
 * was ordered, and a priced slip inside a package bought as a gift prices
 * the gift for whoever opens it. Adding a total would also put a second,
 * separately-maintained rendering of an amount in front of a customer — the
 * thing CLAUDE.md non-negotiable 5.5 exists to prevent for the price on the
 * product page.
 *
 * ## Why it says something about returns
 *
 * Drop one's return policy is "email us" (ADR-0007), and the slip is the one
 * surface a buyer is holding when they discover a problem. The wording here
 * deliberately states no window, no address and no phone — it points at the
 * pre-contract page, which is the page that carries the real disclosure
 * (#92), and at hello@. It must stay consistent with #66's Shopify policy
 * slot and with that page; if one changes they all change.
 */
import { renderPrintShell, SITE_URL } from './shell.ts'
import { t } from '../liquid.ts'
import { SENDER_IDENTITY } from '../../../src/lib/consent.ts'
import type { PrintTemplate } from './types.ts'

/** Printed, not linked: a URL on paper has to be typed by whoever reads it,
 * so it is written bare (no scheme, no trailing slash) and points at the
 * pre-contract route in the reader's own language — `ROUTES` in
 * src/i18n/utils.ts is the source of both paths. */
const bareSite = SITE_URL.replace(/^https:\/\//, '')

const heading = t('Bon de livraison', 'Packing slip')

/**
 * Ship-to, plus the order's own reference. `format_address` returns
 * Shopify's pre-formatted multi-line HTML, the same filter the notification
 * address block uses.
 */
const addresses = `    <div class="na-cols">
      <div class="na-col">
        <div class="na-label">${t('Expédié à', 'Ship to')}</div>
        {{ order.shipping_address | format_address }}
      </div>
      <div class="na-col">
        <div class="na-label">${t('Commande', 'Order')}</div>
        {{ order.name }}<br />
        {{ order.email }}
      </div>
    </div>`

/**
 * The items in this shipment. SKU is printed because it is what a size and
 * fit are actually checked against when packing — `ls-01-classic-m` is
 * unambiguous in a way "Classique / M" read off a screen at arm's length is
 * not (src/lib/catalogue.ts holds the same SKUs the Storefront API joins on).
 */
const items = `    <table>
      <thead>
        <tr>
          <th>${t('Article', 'Item')}</th>
          <th class="na-qty">${t('Qté', 'Qty')}</th>
        </tr>
      </thead>
      <tbody>
        {% for line_item in line_items %}
        <tr>
          <td>
            {{ line_item.title }}
            {% if line_item.variant_title %}<span class="na-variant">{{ line_item.variant_title }}</span>{% endif %}
            {% if line_item.sku %}<span class="na-sku">{{ line_item.sku }}</span>{% endif %}
          </td>
          <td class="na-qty">{{ line_item.quantity }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>`

/** The buyer's own note, when they left one at checkout. Printed because
 * nobody reads the order in the admin while packing it. */
const note = `    {% if order.note %}
    <div class="na-note">
      <div class="na-label">${t('Note', 'Note')}</div>
      {{ order.note }}
    </div>
    {% endif %}`

const message = `    <p class="na-msg">${t(
  'Merci — vous portez le premier vêtement que nous ayons fabriqué.',
  'Thank you — you are wearing the first garment we ever made.'
)}</p>
    <p class="na-msg">${t(
  `Un problème avec votre commande&nbsp;? Écrivez-nous à ${SENDER_IDENTITY.email} et nous le réglerons.`,
  `A problem with your order? Write to us at ${SENDER_IDENTITY.email} and we will sort it out.`
)}</p>
    <p class="na-msg">${t(
  `Nos conditions de vente&nbsp;: ${bareSite}/informations-precontractuelles`,
  `Our terms of sale: ${bareSite}/en/pre-contract-information`
)}</p>`

const body = [addresses, items, note, message].join('\n')

export const packingSlip: PrintTemplate = {
  file: 'packing-slip',
  adminName: 'Packing slip (Settings → Shipping and delivery)',
  html: renderPrintShell({ heading, bodyLiquid: body }),
}
