import type { PickupDetail } from '@/db/queries/pickups'
import { nullIfBlank } from '@/lib/actions/orders.validation'
import type {
  CreatePickupInput,
  UpdatePickupInput,
} from '@/lib/actions/pickups.validation'

/**
 * Shared Tailwind class string for every text/number/date input on the pickup
 * form. Re-exported from the order form's schema module rather than
 * re-declared, so the two forms cannot drift visually — the same reuse
 * `lib/actions/pickups.validation.ts` already makes of `orders.validation`'s
 * shared limits.
 */
export { FORM_INPUT_CLASS } from '@/components/orders/orderFormSchema'

/**
 * Form values shape for `PickupForm`. Every field is a string because all six
 * are plain registered inputs — unlike the order form, whose quantity cells
 * are bridged through the controlled `QtyGrid` and therefore held as numbers.
 * The two counts are parsed to integers by the action-input transforms below.
 */
export interface PickupFormValues {
  customer_id: string
  qty_275: string
  qty_330: string
  /** `yyyy-MM-dd`, or '' — an empty date means the pickup is unscheduled. */
  pickup_date: string
  address: string
  notes: string
}

/**
 * Blank create-mode defaults. `pickup_date` deliberately starts empty rather
 * than at today (which is what the order form does with its delivery date):
 * an absent pickup date is a real, supported state — the pickup lives in the
 * calendar's unscheduled callout (CONSTRAINT-25) — so defaulting to today
 * would silently schedule every pickup the salesperson creates.
 */
export const EMPTY_PICKUP_FORM_VALUES: PickupFormValues = {
  customer_id: '',
  qty_275: '',
  qty_330: '',
  pickup_date: '',
  address: '',
  notes: '',
}

/**
 * Parses one count field into the whole number the action expects. A blank or
 * unparseable entry becomes 0 — the "at least one tote" invariant is enforced
 * separately (client-side by `totalPickupQuantity`, authoritatively by the
 * server's `requireAtLeastOneQty` superRefine).
 * @param raw The field's literal string value.
 */
export function parsePickupQty(raw: string): number {
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Renders a stored count back into a form field — 0 shows as blank, not "0". */
function qtyToField(count: number): string {
  return count > 0 ? String(count) : ''
}

/**
 * Sums the two tote counts. Used by the form's at-least-one-quantity guard so
 * it can block submit before the action round-trip.
 * @param values The form's current field values.
 */
export function totalPickupQuantity(values: PickupFormValues): number {
  return parsePickupQty(values.qty_275) + parsePickupQty(values.qty_330)
}

/**
 * Seeds `PickupFormValues`. Edit mode: maps the `PickupDetail` row into the
 * form's field shape. Create mode: returns the blank defaults, optionally with
 * the customer pre-selected from a `?customerId=` deep link and the date
 * pre-filled from the calendar column whose `+ Add → Add Pickup` was clicked.
 * @param detail Existing pickup detail (edit mode), or null/undefined for a new pickup.
 * @param lockedCustomerId Customer id to pre-select in create mode.
 * @param initialPickupDate `yyyy-MM-dd` to pre-fill in create mode. Ignored in
 *   edit mode, where the stored date wins — a drawer opened on an existing
 *   pickup must never silently move it.
 * @returns A fully-populated value set for `useForm`'s `defaultValues`.
 */
export function detailToPickupFormValues(
  detail: PickupDetail | null | undefined,
  lockedCustomerId?: string | null,
  initialPickupDate?: string | null,
): PickupFormValues {
  if (!detail) {
    return {
      ...EMPTY_PICKUP_FORM_VALUES,
      customer_id: lockedCustomerId ?? '',
      pickup_date: initialPickupDate ?? '',
    }
  }
  return {
    customer_id: detail.customer_id,
    qty_275: qtyToField(detail.qty_275),
    qty_330: qtyToField(detail.qty_330),
    pickup_date: detail.pickup_date ?? '',
    address: detail.address ?? '',
    notes: detail.notes ?? '',
  }
}

/**
 * Converts form values into the create-pickup action's input shape. Counts are
 * parsed to integers; blank date / address / notes collapse to null so the Zod
 * schema sees absent values consistently.
 * @param values The form's current field values.
 */
export function formValuesToCreatePickupInput(
  values: PickupFormValues,
): CreatePickupInput {
  return {
    customer_id: values.customer_id,
    qty_275: parsePickupQty(values.qty_275),
    qty_330: parsePickupQty(values.qty_330),
    pickup_date: nullIfBlank(values.pickup_date),
    address: nullIfBlank(values.address),
    notes: nullIfBlank(values.notes),
  }
}

/**
 * Converts form values into the update-pickup action's input shape. Identical
 * to the create shape — a pickup has no create-only field, and status
 * transitions are owned by `updatePickupStatus`, never by this form.
 * @param values The form's current field values.
 */
export function formValuesToUpdatePickupInput(
  values: PickupFormValues,
): UpdatePickupInput {
  return formValuesToCreatePickupInput(values)
}
