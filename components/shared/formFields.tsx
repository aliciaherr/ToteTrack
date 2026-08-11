/**
 * Presentational form primitives shared by every form surface (orders,
 * customers, pickups, and the address picker the last two mount).
 *
 * `FieldRow` and `FORM_INPUT_CLASS` used to live in `components/orders/`, which
 * was fine while orders were their only consumer. `AddressSelect` is now shared
 * between the order and pickup forms, and a shared component importing out of a
 * feature folder would have closed an import cycle
 * (`shared/AddressSelect` → `orders/OrderFormFields` → `orders/AddressSelect` →
 * `shared/AddressSelect`). Both symbols moved here.
 *
 * **This module is the only home for either symbol.** The transitional
 * re-export shims in `orders/orderFormSchema`, `orders/OrderFormFields` and
 * `pickups/pickupFormSchema` are gone, and the duplicate class string in
 * `customers/customerFormSchema` with them — every consumer imports from here
 * directly. Nothing here guarantees an old import path still resolves.
 *
 * No `'use client'` directive on purpose: neither export uses a hook, state or
 * an event handler, so the file is valid in both graphs and is pulled into the
 * client bundle by whichever client component imports it.
 */

const LABEL_CLASS = 'text-xs uppercase tracking-wide text-muted-foreground'

/**
 * Shared Tailwind class string for every text/number/date input across the
 * order and pickup forms. Extracted so sub-components stay visually identical
 * without copy-pasting the class list.
 */
export const FORM_INPUT_CLASS =
  'w-full h-11 px-3 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring'

/**
 * One labelled form row: uppercase label, the control, and an optional inline
 * validation message underneath.
 * @param label Visible field label.
 * @param htmlFor Id of the control the label points at. Omitted for rows whose
 *   "control" is a read-only display rather than a focusable input.
 * @param error Validation message rendered below the control, if any.
 * @param children The control itself.
 */
export function FieldRow({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className={LABEL_CLASS} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
