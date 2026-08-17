'use client'

import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { modalVariants } from '@/lib/animations'

// Design spec: destructive action confirm — 300ms ease-in-out shake on the
// confirm button, so the salesperson sees this one is not routine.
const SHAKE_KEYFRAMES = [0, -6, 6, -4, 4, 0]
const SHAKE_DURATION = 0.3

/**
 * The panel inside `DeleteCustomerDialog`'s backdrop. Split into its own file
 * to keep the dialog within CQ-02's 200-line component cap, matching the
 * `GenerateInvoiceParts` / `OrderStatusActionsParts` pattern.
 *
 * `cancelRef` is what `useFocusOnOpen` focuses — deliberately the dismiss
 * button, never the destructive one, so an accidental Enter cannot delete.
 */
export default function DeleteCustomerDialogBody({
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
  cancelRef: React.RefObject<HTMLButtonElement | null>
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
