'use client'

import { Button } from '@/components/ui/button'

// The presentational pieces of `OrderStatusActions` — its error alert, its
// button, and the row shell both status branches render through. Its own
// sibling so both files stay inside the 200-line component cap (CQ-02), on the
// same seam `useStatusActions` already uses: nothing here holds state.

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2"
    >
      {message}
    </div>
  )
}

/** One status button. 44px tall, whatever the branch — the touch-target floor. */
export function StatusButton({
  variant,
  onClick,
  disabled,
  children,
}: {
  variant?: 'destructive' | 'outline'
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      className="min-h-[44px] shrink-0 whitespace-nowrap px-3"
    >
      {children}
    </Button>
  )
}

/**
 * The one layout both status branches wear: inline error above a single row of
 * actions, with the confirmation dialog trailing as a sibling.
 *
 * Shared rather than written twice because the two branches differ only in
 * *which* buttons sit in the row — every copy of the shell is a chance for them
 * to drift, and the `leadingAction` change had already been applied twice by
 * hand (CQ-01).
 *
 * `flex-nowrap` because the widest case — Contact + Mark as Complete + Cancel
 * Order — has to hold one line inside the calendar popup's ~400px usable width,
 * and a wrapped third button there reads as a separate section rather than a
 * peer of the other two.
 *
 * @param errorMessage Inline server error, or null when there is none.
 * @param leadingAction Optional node placed ahead of the status buttons.
 * @param confirmDialog The branch's confirmation dialog. Outside the row: it is
 * a modal, not a peer of the buttons.
 */
export function ActionRow({
  errorMessage,
  leadingAction,
  confirmDialog,
  children,
}: {
  errorMessage: string | null
  leadingAction?: React.ReactNode
  confirmDialog: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      {errorMessage && <ErrorAlert message={errorMessage} />}
      <div className="flex flex-nowrap items-center gap-2">
        {leadingAction}
        {children}
      </div>
      {confirmDialog}
    </div>
  )
}
