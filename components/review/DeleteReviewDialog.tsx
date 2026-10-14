'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useFocusOnOpen } from '@/components/shared/useFocusOnOpen'
import { modalVariants } from '@/lib/animations'

interface DeleteReviewDialogProps {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Esc closes this dialog and nothing else. The review overlay underneath
 * listens for Esc on `window` with no way to stand down, so this listens in the
 * capture phase — which runs before any bubbling `window` listener — and stops
 * the event there. One press closes the confirm; the next closes Review.
 */
function useEscapeClosesOnlyThis(open: boolean, onCancel: () => void) {
  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [open, onCancel])
}

/**
 * In-app confirm for deleting a queued PO (Task 120), never the browser's
 * `confirm()`. Rendered inside the review overlay, whose focus trap narrows to
 * this `role="dialog"` while it is up. Cancel is focused on open so a stray
 * Enter never deletes. The delete itself, its busy state and any error belong
 * to `ReviewActions`; this only asks.
 */
export default function DeleteReviewDialog({ open, onCancel, onConfirm }: DeleteReviewDialogProps) {
  const shouldReduceMotion = useReducedMotion()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useFocusOnOpen(open, cancelRef)
  useEscapeClosesOnlyThis(open, onCancel)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="delete-review-backdrop"
          className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
          variants={shouldReduceMotion ? undefined : modalVariants.backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(event) => {
            if (event.target === event.currentTarget) onCancel()
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-review-title"
        >
          <motion.div
            className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4"
            variants={shouldReduceMotion ? undefined : modalVariants.panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <h2 id="delete-review-title" className="text-lg font-semibold text-foreground">
              Delete this PO? It won&apos;t become an order.
            </h2>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button ref={cancelRef} type="button" variant="ghost" onClick={onCancel} className="min-h-[44px]">
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={onConfirm} className="min-h-[44px]">
                Delete
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
