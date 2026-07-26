'use client'

import { QtyGrid } from '@/components/shared/QtyGrid'
import { type UnitPriceValues } from '@/components/shared/qtyGridValues'
import BackhaulTag from '@/components/shared/BackhaulTag'
import { formatCurrency } from '@/lib/format-currency'
import type { OrderDetail as OrderDetailType } from '@/db/queries/orders'

// Tasks 19 and 33 (PO upload + Claude vision extraction) were both cut from
// v1 scope. This slot only surfaces whether a document was loaded directly
// into Supabase (manual admin path); there is no in-app upload flow.
export function PODocumentSlot({ detail }: { detail: OrderDetailType }) {
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

export function QuantitiesBlock({ detail }: { detail: OrderDetailType }) {
  const unitPrices: UnitPriceValues = {
    unit_price_275_recon: detail.unit_price_275_recon,
    unit_price_275_rebot: detail.unit_price_275_rebot,
    unit_price_275_new: detail.unit_price_275_new,
    unit_price_330_recon: detail.unit_price_330_recon,
    unit_price_330_rebot: detail.unit_price_330_rebot,
    unit_price_330_new: detail.unit_price_330_new,
  }
  return (
    <section
      aria-label="Quantities"
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Quantities
      </span>
      <QtyGrid mode="display" values={detail} unitPrices={unitPrices} showEmptyAsDash />
    </section>
  )
}

export function TotalPriceBlock({ price }: { price: string }) {
  return (
    <section
      aria-label="Total price"
      className="rounded-lg border border-border bg-card p-5 flex items-center justify-between gap-4"
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Total Price
      </span>
      <span className="text-3xl font-semibold tabular-nums text-foreground">
        {formatCurrency(price)}
      </span>
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

export function DetailMetaGrid({ detail }: { detail: OrderDetailType }) {
  return (
    <section
      aria-label="Order details"
      className="rounded-lg border border-border bg-card p-4"
    >
      <FieldRow label="Requested Delivery">
        {detail.requested_delivery_date ?? '—'}
      </FieldRow>
      <FieldRow label="Backhaul">
        {detail.backhaul ? <BackhaulTag /> : 'No'}
      </FieldRow>
      <FieldRow label="Pickup Only">{detail.pickup_only ? 'Yes' : 'No'}</FieldRow>
    </section>
  )
}

export function DeliveryAddressBlock({ address }: { address: string | null }) {
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

export function NotesBlock({ notes }: { notes: string | null }) {
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
