'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import DeleteCustomerDialogBody from './DeleteCustomerDialogBody'
import { useResetOnClose } from '@/components/shared/useResetOnChange'
import { useFocusOnOpen } from '@/components/shared/useFocusOnOpen'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import { modalVariants } from '@/lib/animations'

interface DeleteCustomerDialogProps {
  open: boolean
  companyName: string
  onCancel: () => void
  onConfirm: () => Promise<{ success: true } | { error: string }>
}

/** What `runDelete` writes through, so it can live outside the component. */
interface DeleteDeps {
  setServerError: (value: string | null) => void
  setIsSubmitting: (value: boolean) => void
}

// Hoisted out of the component: nested function bodies count toward the
// enclosing component's length, and the try/catch below took it over the cap.
async function runDelete(
  onConfirm: () => Promise<{ success: true } | { error: string }>,
  companyName: string,
  { setServerError, setIsSubmitting }: DeleteDeps,
): Promise<void> {
  setServerError(null)
  setIsSubmitting(true)
  try {
    const result = await onConfirm()
    // Success deliberately leaves `isSubmitting` true. `CustomerForm.handleDelete`
    // closes the dialog and calls `onDeleted()` in the same batch, which swings
    // the right panel back to the detail view and unmounts this dialog outright
    // — the flag dies with it, so nothing here needs to clear it, and clearing
    // it would briefly re-enable a destructive button on a dialog already on its
    // way out. (`useResetOnClose` above covers the Cancel/Escape path, where the
    // dialog closes without unmounting.)
    if ('error' in result) {
      setServerError(result.error)
      setIsSubmitting(false)
    }
  } catch (cause) {
    // A transport-level rejection (offline, stale action id after a deploy)
    // must surface as a normal inline error. Escape and backdrop-close are both
    // gated on `isSubmitting`, so an escaping rejection would wedge this dialog
    // open with no message and no way out but a reload (EH-01).
    // `useStatusActions.makeConfirmHandler` absorbs this for the order dialogs;
    // `CustomerForm` has no equivalent, so it is handled here — which also
    // means no future caller can reintroduce the wedge.
    console.error('DeleteCustomerDialog: delete failed in transit', {
      companyName,
      cause,
    })
    setServerError(GENERIC_FAILURE_MESSAGE)
    setIsSubmitting(false)
  }
}

function useEscapeClose(open: boolean, onCancel: () => void, disabled: boolean) {
  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !disabled) onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onCancel, disabled])
}


/**
 * Two-step delete confirmation. Renders an overlay modal on top of the
 * customer form; the confirm button shakes briefly on mount and the user
 * must click "Yes, Delete" explicitly. `onConfirm` returns either success
 * or a user-facing error message (shown inline when the action rejects).
 */
export default function DeleteCustomerDialog({
  open,
  companyName,
  onCancel,
  onConfirm,
}: DeleteCustomerDialogProps) {
  const shouldReduceMotion = useReducedMotion()
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useResetOnClose(open, () => {
    setServerError(null)
    setIsSubmitting(false)
  })

  useFocusOnOpen(open, cancelRef)
  useEscapeClose(open, onCancel, isSubmitting)

  const handleConfirm = () =>
    runDelete(onConfirm, companyName, { setServerError, setIsSubmitting })

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          variants={shouldReduceMotion ? undefined : modalVariants.backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isSubmitting) onCancel()
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-customer-title"
        >
          <DeleteCustomerDialogBody
            companyName={companyName}
            onCancel={onCancel}
            cancelRef={cancelRef}
            onConfirm={handleConfirm}
            isSubmitting={isSubmitting}
            serverError={serverError}
            shouldReduceMotion={Boolean(shouldReduceMotion)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
