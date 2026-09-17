import { orderConfirmation } from './order-confirmation.ts'
import { shippingConfirmation } from './shipping-confirmation.ts'
import { shippingUpdate } from './shipping-update.ts'
import { shipmentOutForDelivery } from './shipment-out-for-delivery.ts'
import { shipmentDelivered } from './shipment-delivered.ts'
import { abandonedCheckout } from './abandoned-checkout.ts'
import { orderCancelled } from './order-cancelled.ts'
import { orderRefund } from './order-refund.ts'
import type { NotificationTemplate } from './types.ts'

/** Every notification template this issue covers, in the order they'd fire
 * for a normal order lifecycle. */
export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  orderConfirmation,
  shippingConfirmation,
  shippingUpdate,
  shipmentOutForDelivery,
  shipmentDelivered,
  abandonedCheckout,
  orderCancelled,
  orderRefund,
]

export type { NotificationTemplate }
