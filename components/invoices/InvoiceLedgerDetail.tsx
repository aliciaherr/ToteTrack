'use client'

import Link from 'next/link'
import type { InvoiceDetail } from '@/db/queries/invoices'
import { InvoicePoRowsTable, formatBillingPeriod } from './InvoiceLedgerParts'
import { formatCurrency } from '@/lib/format-currency'

interface InvoiceLedgerDetailProps {
  detail: InvoiceDetail | null
  backHref: string
}

function DetailHeader({ backHref }: { backHref: string }) {
  return (
    <div className="flex items-center justify-between">
      <Link
        href={backHref}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to ledger
      </Link>
    </div>
  )
}

function NotFoundState({ backHref }: { backHref: string }) {
  return (
    <div className="p-6 space-y-4">
      <DetailHeader backHref={backHref} />
      <p className="py-12 text-center text-sm text-muted-foreground">
        Invoice not found. It may have been deleted or the link is stale.
      </p>
    </div>
  )
}

function InvoiceSummary({ detail }: { detail: InvoiceDetail }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">{detail.invoice_number}</h2>
      <p className="text-sm text-muted-foreground">{formatBillingPeriod(detail.billing_month)}</p>
    </div>
  )
}

/**
 * Read-only invoice detail panel. v3: no status badge, no Mark-as-Paid
 * button (status dropped). Header is just invoice number + billing period
 * — customer column lives on each PO row instead.
 */
export default function InvoiceLedgerDetail({ detail, backHref }: InvoiceLedgerDetailProps) {
  if (!detail) return <NotFoundState backHref={backHref} />

  return (
    <div className="p-6 space-y-4">
      <DetailHeader backHref={backHref} />
      <InvoiceSummary detail={detail} />
      <InvoicePoRowsTable rows={detail.po_rows} />
      <div className="flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Total</span>
        <span className="text-2xl font-semibold text-foreground">
          {formatCurrency(detail.total_amount)}
        </span>
      </div>
    </div>
  )
}
