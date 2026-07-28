'use client'

import { format, parseISO } from 'date-fns'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { QtyGrid } from '@/components/shared/QtyGrid'
import type { UnitPriceValues } from '@/components/shared/qtyGridValues'
import OrderStatusBadge from '@/components/orders/OrderStatusBadge'
import { formatCurrency } from '@/lib/format-currency'
import type { CalendarOrderRow } from '@/db/queries/calendar'

// Presentational pieces of `ProductionCardDialog`, split out to keep that file
// within the 200-line component cap (CQ-02) — the same `*Parts` idiom as
// `OrderDetailParts` and `DayColumnParts`.

/** Long-form date for the dialog, where there is room for the month name. */
function formatLongDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  // `parseISO`, never `new Date(string)` — see `lib/dates.ts`.
  return format(parseISO(isoDate), 'EEE, MMM d yyyy')
}

/**
 * Pulls the six unit-price columns off a calendar row into the shape `QtyGrid`
 * expects. Nulls pass through untouched: `DisplayCell` treats a non-finite
 * price as absent and falls back to the bare quantity, which is what keeps
 * legacy multi-combo orders from rendering `$null`.
 */
export function toUnitPrices(row: CalendarOrderRow): UnitPriceValues {
  return {
    unit_price_275_recon: row.unit_price_275_recon,
    unit_price_275_rebot: row.unit_price_275_rebot,
    unit_price_275_new: row.unit_price_275_new,
    unit_price_330_recon: row.unit_price_330_recon,
    unit_price_330_rebot: row.unit_price_330_rebot,
    unit_price_330_new: row.unit_price_330_new,
  }
}

/** PO number and customer, with the order's status badge on the right. */
export function DialogHeader({ row }: { row: CalendarOrderRow }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1 min-w-0">
        <h2 id="production-card-title" className="text-lg font-semibold text-foreground truncate">
          {row.po_number}
        </h2>
        <p className="text-sm text-muted-foreground truncate">
          {row.customer_name ?? 'Unknown customer'}
        </p>
      </div>
      <OrderStatusBadge status={row.status} />
    </div>
  )
}

/**
 * The six-combo grid plus the derived total. This is the only calendar surface
 * that shows money — cards never do (CONSTRAINT-19).
 */
export function QuantitiesSection({ row }: { row: CalendarOrderRow }) {
  return (
    <section aria-label="Quantities" className="space-y-3">
      <QtyGrid mode="display" values={row} unitPrices={toUnitPrices(row)} showEmptyAsDash />
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Total</span>
        <span className="text-xl font-semibold tabular-nums text-foreground">
          {formatCurrency(row.price)}
        </span>
      </div>
    </section>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0 min-h-[44px]">
      <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">
        {label}
      </span>
      <span className="text-sm text-foreground text-right">{children}</span>
    </div>
  )
}

/**
 * Both dates, side by side and clearly labelled. This is the only surface in
 * the product that shows them together, and the distinction is the whole point
 * of Feature 11 — the production date is when it gets built, the delivery date
 * is what the customer was promised (CONSTRAINT-19).
 *
 * Backhaul deliberately is **not** here: it is a writable pill at the top of
 * the dialog (Task 65), and rendering it twice would leave a read-only `No`
 * sitting under a pill that says otherwise until the next refresh.
 */
export function DetailFields({ row }: { row: CalendarOrderRow }) {
  return (
    <section aria-label="Order details">
      <FieldRow label="Production Date">{formatLongDate(row.production_date)}</FieldRow>
      <FieldRow label="Requested Delivery">
        {formatLongDate(row.requested_delivery_date)}
      </FieldRow>
    </section>
  )
}

/** Free-text order notes, or a placeholder when there are none. */
export function NotesSection({ notes }: { notes: string | null }) {
  return (
    <section aria-label="Notes" className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
      <p className="text-sm text-foreground whitespace-pre-wrap">
        {notes?.trim() ? notes : 'No notes.'}
      </p>
    </section>
  )
}

/**
 * `Remove from calendar` beside `Open in Orders`. There is deliberately no save
 * action — editing an order lives in the Orders tab, and the link is how you
 * get there (CONSTRAINT-19).
 */
export function DialogFooter({
  orderId,
  isBusy,
  onRemove,
}: {
  orderId: string
  isBusy: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <Button
        type="button"
        variant="ghost"
        onClick={onRemove}
        disabled={isBusy}
        className="min-h-[44px]"
      >
        Remove from calendar
      </Button>
      <Link href={`/orders?id=${orderId}`} className={cn(buttonVariants(), 'min-h-[44px]')}>
        Open in Orders
      </Link>
    </div>
  )
}
