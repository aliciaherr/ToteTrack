'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { convertLeadToCustomer } from '@/lib/actions/leads'
import { modalVariants } from '@/lib/animations'

interface ConvertLeadDialogProps {
  open: boolean
  leadId: string
  leadName: string
  onCancel: () => void
}

// Design spec: 300ms ease-in-out shake on the destructive confirm button.
const SHAKE_KEYFRAMES = [0, -6, 6, -4, 4, 0]

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

function DialogBody({
  leadName,
  warning,
  serverError,
  isSubmitting,
  shouldReduceMotion,
  cancelRef,
  onCancel,
  onConfirm,
}: {
  leadName: string
  warning: string | null
  serverError: string | null
  isSubmitting: boolean
  shouldReduceMotion: boolean
  cancelRef: React.RefObject<HTMLButtonElement>
  onCancel: () => void
  onConfirm: (force: boolean) => void
}) {
  const shake = shouldReduceMotion
    ? undefined
    : { x: SHAKE_KEYFRAMES, transition: { duration: 0.3, ease: 'easeInOut' as const } }

  return (
    <motion.div
      className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4"
      variants={shouldReduceMotion ? undefined : modalVariants.panel}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="space-y-2">
        <h2 id="convert-lead-title" className="text-lg font-semibold text-foreground">
          Convert {leadName} to a customer?
        </h2>
        <p className="text-sm text-muted-foreground">
          This will create a new customer record and archive this lead.
        </p>
      </div>
      {warning && (
        <div role="alert" className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          {warning}
        </div>
      )}
      {serverError && (
        <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
          {serverError}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          ref={cancelRef}
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isSubmitting}
          className="min-h-[44px]"
        >
          Cancel
        </Button>
        <motion.div animate={shake}>
          <Button
            type="button"
            onClick={() => onConfirm(Boolean(warning))}
            disabled={isSubmitting}
            className="min-h-[44px] bg-primary text-primary-foreground"
          >
            {isSubmitting ? 'Converting…' : warning ? 'Convert Anyway' : 'Confirm'}
          </Button>
        </motion.div>
      </div>
    </motion.div>
  )
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

  useEffect(() => {
    if (!open) {
      setWarning(null)
      setServerError(null)
      setIsSubmitting(false)
      return
    }
    cancelRef.current?.focus()
  }, [open])

  useEscapeClose(open, onCancel, isSubmitting)

  async function handleConfirm(force: boolean) {
    setServerError(null)
    setIsSubmitting(true)
    const result = await convertLeadToCustomer(leadId, force)
    if ('customerId' in result) {
      router.push(`/customers?id=${result.customerId}`)
    } else if ('warning' in result) {
      setWarning(result.warning)
      setIsSubmitting(false)
    } else {
      setServerError(result.error)
      setIsSubmitting(false)
    }
  }

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
          <DialogBody
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
