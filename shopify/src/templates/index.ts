import { orderConfirmation } from './order-confirmation.ts'
import { orderInvoice } from './order-invoice.ts'
import { orderEdited } from './order-edited.ts'
import { shippingConfirmation } from './shipping-confirmation.ts'
import { shippingUpdate } from './shipping-update.ts'
import { shipmentOutForDelivery } from './shipment-out-for-delivery.ts'
import { shipmentDelivered } from './shipment-delivered.ts'
import { abandonedCheckout } from './abandoned-checkout.ts'
import { orderCancelled } from './order-cancelled.ts'
import { orderRefund } from './order-refund.ts'
import { contactCustomer } from './contact-customer.ts'
import type { NotificationTemplate } from './types.ts'

/** Every notification template this repo generates, in the order they'd fire
 * for a normal order lifecycle — with the two that don't belong to a
 * lifecycle at all (an invoice for an order that never came through the
 * site, and a message typed by hand) at the ends where they can't be
 * mistaken for one.
 *
 * What is deliberately *not* here — returns, customer accounts, local
 * pickup, gift cards, POS, B2B — is listed with its reason in
 * shopify/notifications/README.md, so a missing template reads as a decision
 * rather than an oversight. */
export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  orderConfirmation,
  orderInvoice,
  orderEdited,
  shippingConfirmation,
  shippingUpdate,
  shipmentOutForDelivery,
  shipmentDelivered,
  abandonedCheckout,
  orderCancelled,
  orderRefund,
  contactCustomer,
]

export type { NotificationTemplate }
