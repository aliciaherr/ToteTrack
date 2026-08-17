'use client'

import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { modalVariants } from '@/lib/animations'

// Design spec: 300ms ease-in-out shake on the confirm button.
const SHAKE_KEYFRAMES = [0, -6, 6, -4, 4, 0]
const SHAKE_DURATION = 0.3

/**
 * The panel inside `ConvertLeadDialog`'s backdrop. Split into its own file to
 * keep the dialog within CQ-02's 200-line component cap, matching the
 * `GenerateInvoiceParts` / `OrderStatusActionsParts` pattern.
 *
 * The confirm button is the duplicate-customer gate: with no `warning` it
 * reads "Confirm" and converts normally; once the server has reported a
 * possible duplicate it reads "Convert Anyway" and passes `force`. That is why
 * `ConvertLeadDialog` clears `warning` on close — a stale one would leave a
 * reopened dialog pre-armed to force past the gate.
 */
export default function ConvertLeadDialogBody({
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
  cancelRef: React.RefObject<HTMLButtonElement | null>
  onCancel: () => void
  onConfirm: (force: boolean) => void
}) {
  const shake = shouldReduceMotion
    ? undefined
    : { x: SHAKE_KEYFRAMES, transition: { duration: SHAKE_DURATION, ease: 'easeInOut' as const } }

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
