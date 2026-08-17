'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import ConvertLeadDialogBody from './ConvertLeadDialogBody'
import { useResetOnClose } from '@/components/shared/useResetOnChange'
import { useFocusOnOpen } from '@/components/shared/useFocusOnOpen'
import { convertLeadToCustomer } from '@/lib/actions/leads'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import { modalVariants } from '@/lib/animations'

interface ConvertLeadDialogProps {
  open: boolean
  leadId: string
  leadName: string
  onCancel: () => void
}

/** What `runConvert` writes through, so it can live outside the component. */
interface ConvertDeps {
  setWarning: (value: string | null) => void
  setServerError: (value: string | null) => void
  setIsSubmitting: (value: boolean) => void
  navigate: (customerId: string) => void
}

// Hoisted out of the component: nested function bodies count toward the
// enclosing component's length, and the try/catch below took it over the cap.
async function runConvert(
  leadId: string,
  force: boolean,
  { setWarning, setServerError, setIsSubmitting, navigate }: ConvertDeps,
): Promise<void> {
  setServerError(null)
  setIsSubmitting(true)
  try {
    const result = await convertLeadToCustomer(leadId, force)
    if ('customerId' in result) {
      // Success deliberately leaves `isSubmitting` true — navigating away is
      // the exit, and re-enabling first would let a second click fire a second
      // conversion.
      navigate(result.customerId)
    } else if ('warning' in result) {
      setWarning(result.warning)
      setIsSubmitting(false)
    } else {
      setServerError(result.error)
      setIsSubmitting(false)
    }
  } catch (cause) {
    // This dialog calls the server action directly — unlike the order dialogs,
    // nothing wraps it. A transport-level rejection (offline, stale action id
    // after a deploy) would otherwise escape into a floating promise, leaving
    // `isSubmitting` stuck true: Cancel, Escape and backdrop-close are all
    // gated on it, and `LeadLayout` only clears `showConvertDialog` via
    // `onCancel`, so the modal would be unclosable without a reload (EH-01).
    console.error('ConvertLeadDialog: convert failed in transit', {
      leadId,
      force,
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
 * Overlay dialog for converting a lead to a customer. On first confirm, calls
 * the server action which may return a { warning } when a customer with the
 * same company name already exists. The user can then "Convert Anyway" (force).
 * On success, navigates to the new customer's detail view.
 */
export default function ConvertLeadDialog({
  open,
  leadId,
  leadName,
  onCancel,
}: ConvertLeadDialogProps) {
  const router = useRouter()
  const shouldReduceMotion = useReducedMotion()
  const [warning, setWarning] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // `warning` in particular must not survive a close: the confirm button
  // derives its force-flag from it, so a stale warning would leave a reopened
  // dialog pre-armed to force-convert past the duplicate-customer gate.
  useResetOnClose(open, () => {
    setWarning(null)
    setServerError(null)
    setIsSubmitting(false)
  })

  useFocusOnOpen(open, cancelRef)

  useEscapeClose(open, onCancel, isSubmitting)

  const handleConfirm = (force: boolean) =>
    runConvert(leadId, force, {
      setWarning,
      setServerError,
      setIsSubmitting,
      navigate: (customerId) => router.push(`/customers?id=${customerId}`),
    })

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
          aria-labelledby="convert-lead-title"
        >
          <ConvertLeadDialogBody
            leadName={leadName}
            warning={warning}
            serverError={serverError}
            isSubmitting={isSubmitting}
            shouldReduceMotion={Boolean(shouldReduceMotion)}
            cancelRef={cancelRef}
            onCancel={onCancel}
            onConfirm={handleConfirm}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
