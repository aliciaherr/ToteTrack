'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { formatPoTotal } from '@/components/shared/qtyGridValues'
import PickupStatusBadge from './PickupStatusBadge'
import { updatePickupStatus } from '@/lib/actions/pickups'
import { useToast } from '@/lib/hooks/useToast'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import type {
  PickupDetail as PickupDetailType,
  PickupStatus,
} from '@/db/queries/pickups'

/**
 * One status transition, its in-flight state and its error channel. A failed
 * transition surfaces inline rather than silently no-op'ing (EH-01); a
 * transport rejection is logged with the pickup id and target before it is
 * replaced by the generic message (EH-02).
 * @param pickupId The pickup whose status is being moved.
 * @returns The `move` callback, a combined in-flight `disabled` flag, and the
 *   inline error message (null when the last attempt succeeded).
 */
function useStatusTransition(pickupId: string) {
  const router = useRouter()
  const { toast } = useToast()
  const [isRefreshing, startTransition] = useTransition()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const move = useCallback(
    async (target: PickupStatus, successMessage: string): Promise<void> => {
      setErrorMessage(null)
      setIsSubmitting(true)
      try {
        const result = await updatePickupStatus(pickupId, target)
        if ('error' in result) {
          setErrorMessage(result.error)
          return
        }
        toast(successMessage, 'success')
        startTransition(() => router.refresh())
      } catch (cause) {
        console.error('PickupDetail: status transition failed', {
          operation: 'updatePickupStatus',
          pickupId,
          target,
          cause,
        })
        setErrorMessage(GENERIC_FAILURE_MESSAGE)
      } finally {
        setIsSubmitting(false)
      }
    },
    [pickupId, router, toast],
  )

  return { move, disabled: isSubmitting || isRefreshing, errorMessage }
}

/**
 * Status transition buttons. Cancelling is the only removal a pickup has —
 * there is no delete, here or anywhere else in this vertical.
 *
 * Unlike `CancelOrderDialog`, cancelling needs no confirmation step: a pickup
 * carries no price, invoice or document, and `updatePickupStatus` explicitly
 * allows `cancelled → scheduled`, so the act is reversible in one click. The
 * order dialog exists because an order cancel is not.
 */
function StatusActions({ detail }: { detail: PickupDetailType }) {
  const { move, disabled, errorMessage } = useStatusTransition(detail.id)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {detail.status === 'scheduled' ? (
          <>
            <Button
              variant="outline"
              className="min-h-[44px]"
              disabled={disabled}
              onClick={() => move('completed', 'Pickup marked as complete.')}
            >
              Mark as Complete
            </Button>
            <Button
              variant="destructive"
              className="min-h-[44px]"
              disabled={disabled}
              onClick={() => move('cancelled', 'Pickup cancelled.')}
            >
              Cancel Pickup
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            className="min-h-[44px]"
            disabled={disabled}
            onClick={() => move('scheduled', 'Pickup reopened.')}
          >
            Reopen Pickup
          </Button>
        )}
      </div>
      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

/** Status card: the current badge plus this pickup's legal transitions. */
export function PickupStatusBlock({ detail }: { detail: PickupDetailType }) {
  return (
    <section
      aria-label="Pickup status"
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Status</span>
        <PickupStatusBadge status={detail.status} />
      </div>
      <StatusActions detail={detail} />
    </section>
  )
}

function CountCell({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2 flex items-center justify-between gap-2 min-h-[44px]">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-foreground">
        {formatPoTotal(count)}
      </span>
    </div>
  )
}

/**
 * The two tote counts side by side. A zero count renders as an em dash, the
 * same `formatPoTotal` treatment the table row gives it.
 */
export function ToteCountsBlock({ detail }: { detail: PickupDetailType }) {
  return (
    <section
      aria-label="Tote counts"
      className="rounded-lg border border-border bg-card p-4 grid grid-cols-2 gap-3"
    >
      <CountCell label="275 gal" count={detail.qty_275} />
      <CountCell label="330 gal" count={detail.qty_330} />
    </section>
  )
}

/**
 * Card section with a heading and a wrapped block of free text.
 * @param label Section heading, also its accessible name.
 * @param value The stored text, or null.
 * @param fallback Shown when `value` is null or whitespace-only.
 */
export function TextBlock({
  label,
  value,
  fallback,
}: {
  label: string
  value: string | null
  fallback: string
}) {
  return (
    <section
      aria-label={label}
      className="rounded-lg border border-border bg-card p-4 space-y-2"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="text-sm text-foreground whitespace-pre-wrap">
        {value?.trim() ? value : fallback}
      </p>
    </section>
  )
}
