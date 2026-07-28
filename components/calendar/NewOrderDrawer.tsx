'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import OrderForm from '@/components/orders/OrderForm'
import DetailDrawer from '@/components/shell/DetailDrawer'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface NewOrderDrawerProps {
  /** The clicked column's day as `yyyy-MM-dd`, or null when the drawer is shut. */
  productionDate: string | null
  customers: CustomerSelectOption[]
  onClose: () => void
}

/**
 * The right-hand drawer that creates a PO on a chosen production day, without
 * leaving `/calendar`.
 *
 * Reuses the Orders tab's `OrderForm` verbatim rather than a calendar-specific
 * form — a PO created here is the same record with the same rules, and a second
 * form would drift. The only difference is `productionDate`, which pins the new
 * row to the column whose `+` was clicked regardless of the delivery date
 * entered (CONSTRAINT-19).
 *
 * `alwaysOverlay` is required, not cosmetic: the calendar root is a fixed-height
 * `overflow-hidden` column, so `DetailDrawer`'s default lg+ inline docking would
 * either clip the form or make the page scroll.
 *
 * The form is mounted only while the drawer is open so each visit starts from
 * `EMPTY_FORM_VALUES` — a form left mounted would carry the previous day's
 * half-typed PO into the next column the salesperson clicks.
 *
 * @param productionDate The chosen build day, or null to keep the drawer shut.
 * @param customers Active customers for the form's dropdown.
 * @param onClose Clears the chosen day — backdrop, ✕ and Escape all route here.
 */
export default function NewOrderDrawer({
  productionDate,
  customers,
  onClose,
}: NewOrderDrawerProps) {
  const router = useRouter()

  // `router.refresh()` re-runs the page's server fetches, so the new card
  // appears in its column from the database rather than from optimistic client
  // state (CONSTRAINT-02).
  const handleSaved = useCallback(() => {
    onClose()
    router.refresh()
  }, [onClose, router])

  return (
    <DetailDrawer
      isOpen={productionDate !== null}
      onClose={onClose}
      ariaLabel="New purchase order"
      alwaysOverlay
    >
      {productionDate !== null && (
        <OrderForm
          mode="create"
          customers={customers}
          lockedCustomerId={null}
          productionDate={productionDate}
          onClose={onClose}
          onSaved={handleSaved}
        />
      )}
    </DetailDrawer>
  )
}
