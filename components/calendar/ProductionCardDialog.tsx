'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { modalVariants } from '@/lib/animations'
import { useDialogActions, useEscapeClose, useFocusTrap } from './productionCardDialogHooks'
import {
  DetailFields,
  DialogFooter,
  DialogHeader,
  NotesSection,
  QuantitiesSection,
  SameDayToggleRow,
} from './ProductionCardDialogParts'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface ProductionCardDialogProps {
  open: boolean
  row: CalendarOrderRow | null
  onClose: () => void
  onToggleSameDay: (orderId: string, next: boolean) => Promise<void>
  onRemove: (orderId: string) => Promise<void>
}

/** Dimmed overlay. Clicking it — but not the panel inside it — dismisses. */
function DialogBackdrop({
  shouldReduceMotion,
  isBusy,
  onClose,
  children,
}: {
  shouldReduceMotion: boolean
  isBusy: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <motion.div
      key="backdrop"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      variants={shouldReduceMotion ? undefined : modalVariants.backdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="production-card-title"
    >
      {children}
    </motion.div>
  )
}

/** The panel itself — everything inside the backdrop. */
function DialogPanel({
  row,
  isBusy,
  panelRef,
  shouldReduceMotion,
  onToggle,
  onRemove,
}: {
  row: CalendarOrderRow
  isBusy: boolean
  panelRef: React.RefObject<HTMLDivElement>
  shouldReduceMotion: boolean
  onToggle: (next: boolean) => void
  onRemove: () => void
}) {
  return (
    <motion.div
      ref={panelRef}
      data-testid="production-card-dialog"
      className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto calendar-scroll"
      variants={shouldReduceMotion ? undefined : modalVariants.panel}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <DialogHeader row={row} />
      <SameDayToggleRow
        checked={row.same_day_delivery}
        disabled={isBusy}
        onChange={onToggle}
      />
      <QuantitiesSection row={row} />
      <DetailFields row={row} />
      <NotesSection notes={row.notes} />

      <DialogFooter orderId={row.id} isBusy={isBusy} onRemove={onRemove} />
    </motion.div>
  )
}

/**
 * Read-only detail popup for a production card.
 *
 * Everything on it is read-only apart from the same-day-delivery toggle:
 * editing an order stays exclusive to the Orders tab, which is why the footer
 * offers `Open in Orders` rather than a save action (CONSTRAINT-19). The
 * quantity grid is `QtyGrid` in display mode **with `unitPrices` supplied**, so
 * filled cells read `qty / $unit` exactly as PO detail has since Feature 10 —
 * and cells whose price was never set fall back to the bare quantity rather
 * than rendering `$null`.
 *
 * This is also where prices live at all. Cards never show money; the popup is
 * the commercial view of the same order.
 *
 * @param open Whether the dialog is mounted and visible.
 * @param row The order to show, or null when nothing is selected.
 * @param onClose Dismisses the dialog.
 * @param onToggleSameDay Persists the same-day flag.
 * @param onRemove Clears the production placement, then closes.
 */
export default function ProductionCardDialog({
  open,
  row,
  onClose,
  onToggleSameDay,
  onRemove,
}: ProductionCardDialogProps) {
  const shouldReduceMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const isOpen = open && row !== null
  const { isBusy, setIsBusy, handleToggle, handleRemove } = useDialogActions(
    row,
    onToggleSameDay,
    onRemove,
    onClose,
  )

  useEscapeClose(isOpen, onClose, isBusy)
  useFocusTrap(isOpen, panelRef)

  useEffect(() => {
    if (!isOpen) setIsBusy(false)
  }, [isOpen, setIsBusy])

  return (
    <AnimatePresence>
      {isOpen && row && (
        <DialogBackdrop
          shouldReduceMotion={Boolean(shouldReduceMotion)}
          isBusy={isBusy}
          onClose={onClose}
        >
          <DialogPanel
            row={row}
            isBusy={isBusy}
            panelRef={panelRef}
            shouldReduceMotion={Boolean(shouldReduceMotion)}
            onToggle={handleToggle}
            onRemove={handleRemove}
          />
        </DialogBackdrop>
      )}
    </AnimatePresence>
  )
}
