'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formValuesToCreateInput, type OrderFormValues } from '@/components/orders/orderFormSchema'
import DeleteReviewDialog from './DeleteReviewDialog'
import { approvalProblems } from './reviewApproval'
import { useReviewDecisions, type ReviewDecision } from './useReviewDecisions'

interface ReviewActionsProps {
  /** The `inbound_pos.id` on screen. */
  poId: string
  /** The review form's current values; Approve checks and sends these. */
  values: OrderFormValues
  /** Asks the queue to reload and load its next PO. */
  onDecided: () => void
}

const BUSY_LABEL: Record<ReviewDecision, string> = {
  approve: 'Approving…',
  skip: 'Skipping…',
  discard: 'Deleting…',
}

/** One alert above the buttons: Approve's blocking problems, else the last action's error. */
function ActionAlert({ problems, error }: { problems: string[]; error: string | null }) {
  if (problems.length === 0 && !error) return null
  return (
    <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
      {problems.length > 0 ? (
        <>
          <p className="font-medium">Fix these before approving:</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>{error}</p>
      )}
    </div>
  )
}

/**
 * Approve, Skip and Delete at the foot of the review pane (Task 120). Approve
 * with problems lists them and sends nothing; otherwise it sends
 * `formValuesToCreateInput(values)`. Delete asks first, in-app. All three are
 * disabled while any one runs, so one tap is one action. Errors stay inline
 * above the buttons and the reviewer's edits are kept.
 */
export default function ReviewActions({ poId, values, onDecided }: ReviewActionsProps) {
  const { busy, error, approve, skip, discard } = useReviewDecisions(poId, onDecided)
  const [problems, setProblems] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const disabled = busy !== null

  function handleApprove() {
    const found = approvalProblems(values)
    setProblems(found)
    if (found.length === 0) void approve(formValuesToCreateInput(values))
  }

  function handleSkip() {
    setProblems([])
    void skip()
  }

  function handleCancelDelete() {
    setConfirmOpen(false)
    deleteRef.current?.focus()
  }

  function handleConfirmDelete() {
    setConfirmOpen(false)
    setProblems([])
    void discard()
  }

  return (
    <div className="space-y-3">
      <ActionAlert problems={problems} error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={deleteRef}
          type="button"
          variant="destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={disabled}
          className="min-h-[44px]"
        >
          {busy === 'discard' ? BUSY_LABEL.discard : 'Delete'}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" onClick={handleSkip} disabled={disabled} className="min-h-[44px]">
            {busy === 'skip' ? BUSY_LABEL.skip : 'Skip'}
          </Button>
          <Button type="button" onClick={handleApprove} disabled={disabled} className="min-h-[44px]">
            {busy === 'approve' ? BUSY_LABEL.approve : 'Approve'}
          </Button>
        </div>
      </div>
      <DeleteReviewDialog open={confirmOpen} onCancel={handleCancelDelete} onConfirm={handleConfirmDelete} />
    </div>
  )
}
