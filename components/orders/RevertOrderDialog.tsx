'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { modalVariants } from '@/lib/animations'
import type { PoStatus } from '@/db/queries/orders'

interface RevertOrderDialogProps {
  open: boolean
  poNumber: string
  currentStatus: PoStatus
  onCancel: () => void
  onConfirm: () => Promise<{ success: true } | { error: string }>
}

function bodyCopyFor(status: PoStatus): string {
  if (status === 'invoiced') {
    return 'This will detach the order from its invoice and recompute the invoice total. If this is the only order on the invoice, the invoice will be deleted.'
  }
  if (status === 'cancelled') {
    return 'This will move the order back to the open Scheduled list. You can re-cancel or mark complete from there.'
  }
  return 'This will move the order back to the open Scheduled list. You can re-mark complete or cancel from there.'
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

function DialogBody({
  poNumber,
  currentStatus,
  onCancel,
  cancelRef,
  onConfirm,
  isSubmitting,
  serverError,
  shouldReduceMotion,
}: {
  poNumber: string
  currentStatus: PoStatus
  onCancel: () => void
  cancelRef: React.RefObject<HTMLButtonElement>
  onConfirm: () => void
  isSubmitting: boolean
  serverError: string | null
  shouldReduceMotion: boolean
}) {
  return (
    <motion.div
      className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4"
      variants={shouldReduceMotion ? undefined : modalVariants.panel}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="space-y-2">
        <h2 id="revert-order-title" className="text-lg font-semibold text-foreground">
          Revert order {poNumber} to scheduled?
        </h2>
        <p className="text-sm text-muted-foreground">{bodyCopyFor(currentStatus)}</p>
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
          Keep As-Is
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          className="min-h-[44px]"
        >
          {isSubmitting ? 'Reverting…' : 'Yes, Revert'}
        </Button>
      </div>
    </motion.div>
  )
}

/**
 * Confirmation dialog for reverting a terminal-state order back to
 * scheduled. Body copy is status-aware: the invoiced case spells out the
 * invoice-side cleanup so the salesperson knows the recompute / delete is
 * about to happen.
 */
export default function RevertOrderDialog({
  open,
  poNumber,
  currentStatus,
  onCancel,
  onConfirm,
}: RevertOrderDialogProps) {
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
          aria-labelledby="revert-order-title"
        >
          <DialogBody
            poNumber={poNumber}
            currentStatus={currentStatus}
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
