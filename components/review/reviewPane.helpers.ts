import { totalQuantity, type OrderFormValues } from '@/components/orders/orderFormSchema'
import type { FieldFlag, ReviewFlagKind } from '@/lib/review/review-fields.types'

/**
 * Pure helpers behind the review overlay's right pane (Task 119): the order
 * the "To check" section lists flags in, the lines it adds for fields left
 * empty, and each field group's green / red / neutral status.
 */

/**
 * Flags that ask the salesperson to choose or enter something. Every other
 * kind says a check failed, and those are listed first.
 */
const CHOICE_KINDS: ReadonlySet<ReviewFlagKind> = new Set<ReviewFlagKind>([
  'ambiguous_customer',
  'no_customer_match',
  'multiple_delivery_dates',
  'ambiguous_date',
  'missing_po_number',
  'missing_ship_to',
])

/** True when the flag reports a failed check rather than asking for a choice. */
export function isFailureFlag(flag: FieldFlag): boolean {
  return !CHOICE_KINDS.has(flag.kind)
}

/** Every flag, failures first; the order within each group is kept. */
export function orderFlags(flags: FieldFlag[]): FieldFlag[] {
  return [...flags.filter(isFailureFlag), ...flags.filter((flag) => !isFailureFlag(flag))]
}

/** A part of the form that carries one status border. */
export type FieldGroup = 'po_number' | 'customer_id' | 'delivery_address' | 'quantities' | 'requested_delivery_date'

export const FIELD_GROUPS: readonly FieldGroup[] = [
  'po_number',
  'customer_id',
  'delivery_address',
  'quantities',
  'requested_delivery_date',
]

/** The flags that make a group need attention. A total mismatch implicates the quantities and prices. */
function flagsIn(group: FieldGroup, flags: FieldFlag[]): FieldFlag[] {
  if (group !== 'quantities') return flags.filter((flag) => flag.field === group)
  return flags.filter(
    (flag) =>
      flag.field.startsWith('qty_') ||
      flag.field.startsWith('unit_price_') ||
      flag.field === 'totals' ||
      flag.kind === 'no_tote_lines',
  )
}

/** True when the group has no value. An address is never missing when the customer collects. */
function isEmpty(group: FieldGroup, values: OrderFormValues): boolean {
  switch (group) {
    case 'quantities':
      return totalQuantity(values) <= 0
    case 'delivery_address':
      return !values.customer_collects && values.delivery_address.trim() === ''
    default:
      return values[group].trim() === ''
  }
}

const MISSING_LINES: Record<FieldGroup, string> = {
  po_number: 'PO number not found: enter it',
  customer_id: 'Customer not chosen: choose one',
  delivery_address: 'Delivery address not found: enter it',
  quantities: 'Quantities not found: enter them',
  requested_delivery_date: 'Delivery date not found: enter it',
}

/**
 * One line per required field the reading left empty, for the "To check"
 * section. A field that already has a flag is not repeated.
 *
 * @param values The pane's values as loaded.
 * @param flags Every flag on the PO.
 */
export function missingFieldLines(values: OrderFormValues, flags: FieldFlag[]): string[] {
  return FIELD_GROUPS.filter((group) => isEmpty(group, values) && flagsIn(group, flags).length === 0).map(
    (group) => MISSING_LINES[group],
  )
}

export type FieldStatus = 'confident' | 'attention' | 'neutral'

/**
 * A group's border: neutral once the salesperson has edited it, red when it is
 * empty or flagged, green otherwise (pre-filled and passed every check that ran).
 */
export function fieldStatus(group: FieldGroup, values: OrderFormValues, flags: FieldFlag[], isEdited: boolean): FieldStatus {
  if (isEdited) return 'neutral'
  if (isEmpty(group, values) || flagsIn(group, flags).length > 0) return 'attention'
  return 'confident'
}

const QUANTITY_KEYS = [
  'qty_275_recon',
  'qty_275_rebot',
  'qty_275_new',
  'qty_330_recon',
  'qty_330_rebot',
  'qty_330_new',
  'unit_price_275_recon',
  'unit_price_275_rebot',
  'unit_price_275_new',
  'unit_price_330_recon',
  'unit_price_330_rebot',
  'unit_price_330_new',
] as const satisfies ReadonlyArray<keyof OrderFormValues>

const GROUP_KEYS: Record<FieldGroup, ReadonlyArray<keyof OrderFormValues>> = {
  po_number: ['po_number'],
  customer_id: ['customer_id'],
  delivery_address: ['delivery_address', 'delivery_address_id', 'customer_collects'],
  quantities: QUANTITY_KEYS,
  requested_delivery_date: ['requested_delivery_date'],
}

/** True when any value in the group differs from what the pane loaded. */
export function isGroupEdited(group: FieldGroup, current: OrderFormValues, loaded: OrderFormValues): boolean {
  return GROUP_KEYS[group].some((key) => current[key] !== loaded[key])
}
