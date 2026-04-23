'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import OrderStatusActions from './OrderStatusActions'
import OrderStatusBadge from './OrderStatusBadge'
import OrderTypeBadge from './OrderTypeBadge'
import { formatCurrency } from '@/lib/format-currency'
import type { OrderDetail as OrderDetailType } from '@/db/queries/orders'

interface OrderDetailProps {
  detail: OrderDetailType | null
  onEdit?: () => void
}

/**
 * Right-panel placeholder shown when no order is selected. Exported so the
 * parent layout can render it directly without mounting a null-stub detail.
 */
export function OrderDetailEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
      Select an order to view details.
    </div>
  )
}

function DetailHeader({
  detail,
  onEdit,
}: {
  detail: OrderDetailType
  onEdit?: () => void
}) {
  const customerLabel = detail.customer_name ?? 'Unknown customer'
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1.5 min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground truncate">
          {detail.po_number}
        </h2>
        <Link
          href={`/customers?id=${detail.customer_id}`}
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline min-h-[44px]"
        >
          <span
            aria-hidden="true"
            className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-semibold select-none"
          >
            {customerLabel.trim()[0]?.toUpperCase() ?? '?'}
          </span>
          <span>{customerLabel}</span>
        </Link>
      </div>
      {onEdit && (
        <Button
          variant="outline"
          onClick={onEdit}
          aria-label={`Edit order ${detail.po_number}`}
          className="min-h-[44px] shrink-0"
        >
          Edit
        </Button>
      )}
    </div>
  )
}

// OrderStatusActions returns null for terminal states, so the slot shows
// only the badge — matching the "no buttons, status badge only" spec.
function StatusActionsSlot({ detail }: { detail: OrderDetailType }) {
  return (
    <section
      aria-label="Order status"
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Status
        </span>
        <OrderStatusBadge status={detail.status} />
      </div>
      <OrderStatusActions
        orderId={detail.id}
        poNumber={detail.po_number}
        currentStatus={detail.status}
      />
    </section>
  )
}

// Tasks 19 and 33 (PO upload + Claude vision extraction) were both cut from
// v1 scope — see plan.md. This slot surfaces whether a document was loaded
// directly into Supabase (manual admin path); there is no in-app upload flow.
// The `document_url` column + `po-documents` bucket stay in the DB for a
// possible future feature.
function PODocumentSlot({ detail }: { detail: OrderDetailType }) {
  const hasDocument = Boolean(detail.document_url)
  return (
    <section
      aria-label="PO document"
      className="rounded-lg border border-border bg-card p-4 space-y-2"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        PO Document
      </div>
      <p className="text-sm text-foreground">
        {hasDocument
          ? 'Document on file (uploaded outside the app).'
          : 'No document on file. In-app upload is not available in v1.'}
      </p>
    </section>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-b-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">
        {label}
      </span>
      <span className="text-sm text-foreground text-right">{children}</span>
    </div>
  )
}

function DetailMetaGrid({ detail }: { detail: OrderDetailType }) {
  return (
    <section
      aria-label="Order details"
      className="rounded-lg border border-border bg-card p-4"
    >
      <FieldRow label="Container Size">{detail.container_size} gal</FieldRow>
      <FieldRow label="Container Type">
        <OrderTypeBadge type={detail.container_type} />
      </FieldRow>
      <FieldRow label="Quantity">{detail.quantity}</FieldRow>
      <FieldRow label="Price">{formatCurrency(detail.price)}</FieldRow>
      <FieldRow label="Requested Delivery">{detail.requested_delivery_date ?? '—'}</FieldRow>
      <FieldRow label="Backhaul">{detail.backhaul ? 'Yes' : 'No'}</FieldRow>
      <FieldRow label="Pickup Only">{detail.pickup_only ? 'Yes' : 'No'}</FieldRow>
    </section>
  )
}

function DeliveryAddressBlock({ address }: { address: string | null }) {
  return (
    <section
      aria-label="Delivery address"
      className="rounded-lg border border-border bg-card p-4 space-y-2"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Delivery Address
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap">
        {address?.trim() ? address : 'No address on file.'}
      </p>
    </section>
  )
}

function NotesBlock({ notes }: { notes: string | null }) {
  return (
    <section
      aria-label="Notes"
      className="rounded-lg border border-border bg-card p-4 space-y-2"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
      <p className="text-sm text-foreground whitespace-pre-wrap">
        {notes?.trim() ? notes : 'No notes.'}
      </p>
    </section>
  )
}

/**
 * Right-panel order detail view. Renders the PO header, status actions,
 * PO document slot, metadata, delivery address (hidden when pickup_only),
 * and notes. Returns the empty state when `detail` is null.
 */
export default function OrderDetail({ detail, onEdit }: OrderDetailProps) {
  if (!detail) return <OrderDetailEmptyState />

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <DetailHeader detail={detail} onEdit={onEdit} />
      <StatusActionsSlot detail={detail} />
      <PODocumentSlot detail={detail} />
      <DetailMetaGrid detail={detail} />
      {!detail.pickup_only && (
        <DeliveryAddressBlock address={detail.delivery_address} />
      )}
      <NotesBlock notes={detail.notes} />
    </div>
  )
}
