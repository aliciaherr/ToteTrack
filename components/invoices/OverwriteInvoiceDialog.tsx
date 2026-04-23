'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { modalVariants } from '@/lib/animations'

interface OverwriteInvoiceDialogProps {
  open: boolean
  existingInvoiceNumber: string
  billingMonthLabel: string
  isSubmitting: boolean
  onCancel: () => void
  onConfirm: () => void
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
 * Confirmation when the salesperson tries to generate an invoice for a
 * month that already has one. Yes-overwrite deletes the existing invoice
 * (its orders detach back to `completed`) and creates a fresh INV-####.
 */
export default function OverwriteInvoiceDialog({
  open,
  existingInvoiceNumber,
  billingMonthLabel,
  isSubmitting,
  onCancel,
  onConfirm,
}: OverwriteInvoiceDialogProps) {
  const shouldReduceMotion = useReducedMotion()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])
  useEscapeClose(open, onCancel, isSubmitting)

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
          aria-labelledby="overwrite-invoice-title"
        >
          <motion.div
            className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4"
            variants={shouldReduceMotion ? undefined : modalVariants.panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="space-y-2">
              <h2 id="overwrite-invoice-title" className="text-lg font-semibold text-foreground">
                Invoice already exists for {billingMonthLabel}
              </h2>
              <p className="text-sm text-muted-foreground">
                {existingInvoiceNumber} already covers this month. Overwriting
                will delete it and replace it with a new invoice that includes
                every currently eligible PO. The old invoice number is retired.
              </p>
            </div>
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
              <Button
                type="button"
                onClick={onConfirm}
                disabled={isSubmitting}
                className="min-h-[44px]"
              >
                {isSubmitting ? 'Overwriting…' : 'Yes, Overwrite'}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
