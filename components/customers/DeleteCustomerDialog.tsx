'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { modalVariants } from '@/lib/animations'

interface DeleteCustomerDialogProps {
  open: boolean
  companyName: string
  onCancel: () => void
  onConfirm: () => Promise<{ success: true } | { error: string }>
}

// Design spec: destructive action confirm — 300ms ease-in-out shake on the
// element. Applied to the confirm button on mount to emphasize the gravity
// of the action.
const SHAKE_KEYFRAMES = [0, -6, 6, -4, 4, 0]
const SHAKE_DURATION = 0.3

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
  companyName,
  onCancel,
  cancelRef,
  onConfirm,
  isSubmitting,
  serverError,
  shouldReduceMotion,
}: {
  companyName: string
  onCancel: () => void
  cancelRef: React.RefObject<HTMLButtonElement>
  onConfirm: () => void
  isSubmitting: boolean
  serverError: string | null
  shouldReduceMotion: boolean
}) {
  const shake = shouldReduceMotion
    ? undefined
    : {
        x: SHAKE_KEYFRAMES,
        transition: { duration: SHAKE_DURATION, ease: 'easeInOut' as const },
      }
  return (
    <motion.div
      className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4"
      variants={shouldReduceMotion ? undefined : modalVariants.panel}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="space-y-2">
        <h2 id="delete-customer-title" className="text-lg font-semibold text-foreground">
          Delete {companyName}?
        </h2>
        <p className="text-sm text-muted-foreground">
          This permanently removes the customer and all contacts. This cannot be undone.
        </p>
      </div>
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
            variant="destructive"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="min-h-[44px]"
          >
            {isSubmitting ? 'Deleting…' : 'Yes, Delete'}
          </Button>
        </motion.div>
      </div>
    </motion.div>
  )
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

  useEffect(() => {
    if (!open) {
      setServerError(null)
      setIsSubmitting(false)
      return
    }
    cancelRef.current?.focus()
  }, [open])
  useEscapeClose(open, onCancel, isSubmitting)

  async function handleConfirm() {
    setServerError(null)
    setIsSubmitting(true)
    const result = await onConfirm()
    if ('error' in result) {
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
          aria-labelledby="delete-customer-title"
        >
          <DialogBody
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
