import { packingSlip } from './packing-slip.ts'
import type { PrintTemplate } from './types.ts'

/** Every printed document generated for the Shopify admin.
 *
 * One entry today, and the shipping label is deliberately not a second one:
 * a carrier label's artwork comes from the carrier (Canada Post), Shopify
 * only renders what their API returns, and there is no template, no logo
 * slot and no colour to set. See shopify/print/README.md — it is written
 * down there so the next person does not go looking for the setting. */
export const PRINT_TEMPLATES: PrintTemplate[] = [packingSlip]

export type { PrintTemplate }
