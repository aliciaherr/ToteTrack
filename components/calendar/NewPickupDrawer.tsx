'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PickupForm from '@/components/pickups/PickupForm'
import DetailDrawer from '@/components/shell/DetailDrawer'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface NewPickupDrawerProps {
  /** The clicked column's day as `yyyy-MM-dd`, or null when the drawer is shut. */
  pickupDate: string | null
  customers: CustomerSelectOption[]
  onClose: () => void
}

/**
 * The right-hand drawer that creates a pickup on a chosen day, without leaving
 * `/calendar`. The sibling of `NewOrderDrawer`, built to the same shape so the
 * two `+ Add` actions behave identically.
 *
 * Reuses the Pickups tab's `PickupForm` verbatim rather than a calendar-specific
 * form — a pickup created here is the same record with the same rules, and a
 * second form would drift.
 *
 * The day is seeded into the form's **visible** `pickup_date` field rather than
 * applied as a hidden override at submit time, which is where this differs from
 * `NewOrderDrawer`. An order's build day is not a form field at all
 * (CONSTRAINT-19), so the calendar has to inject it; a pickup's date *is* the
 * field, and *is* its calendar placement (CONSTRAINT-25) — so the honest thing
 * is to pre-fill it where the salesperson can see and change it before saving.
 *
 * `alwaysOverlay` is required, not cosmetic: the calendar root is a fixed-height
 * `overflow-hidden` column, so `DetailDrawer`'s default lg+ inline docking would
 * either clip the form or make the page scroll.
 *
 * The form is mounted only while the drawer is open so each visit starts from
 * `EMPTY_PICKUP_FORM_VALUES` — a form left mounted would carry the previous
 * day's half-typed pickup into the next column the salesperson clicks.
 *
 * @param pickupDate The chosen collection day, or null to keep the drawer shut.
 * @param customers Active customers for the form's dropdown.
 * @param onClose Clears the chosen day — backdrop, ✕ and Escape all route here.
 */
export default function NewPickupDrawer({
  pickupDate,
  customers,
  onClose,
}: NewPickupDrawerProps) {
  const router = useRouter()

  // `router.refresh()` re-runs the page's server fetches, so the new card
  // appears in its column from the database rather than from optimistic client
  // state (CONSTRAINT-02).
  const handleSaved = useCallback(() => {
    onClose()
    router.refresh()
  }, [onClose, router])

  return (
    <DetailDrawer isOpen={pickupDate !== null} onClose={onClose} ariaLabel="New pickup" alwaysOverlay>
      {pickupDate !== null && (
        <PickupForm
          mode="create"
          customers={customers}
          lockedCustomerId={null}
          initialPickupDate={pickupDate}
          onClose={onClose}
          onSaved={handleSaved}
        />
      )}
    </DetailDrawer>
  )
}
