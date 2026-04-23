import { startOfMonth, parse, isValid, format } from 'date-fns'
import {
  getInvoiceableOrders,
  getInvoices,
  getInvoiceDetail,
  type InvoiceDetail,
} from '@/db/queries/invoices'
import { InvoiceNotFoundError } from '@/lib/errors'
import { isUuid } from '@/lib/validators/uuid'
import InvoiceLayout from '@/components/invoices/InvoiceLayout'
import PageTransition from '@/components/shell/PageTransition'

interface InvoicesPageProps {
  searchParams: {
    billingMonth?: string
    id?: string
  }
}

// YYYY-MM format — anything else falls back to the current month.
const BILLING_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function parseBillingMonth(value: string | undefined): { iso: string; date: Date } {
  if (value && BILLING_MONTH_RE.test(value)) {
    const parsed = parse(value, 'yyyy-MM', new Date())
    if (isValid(parsed)) {
      return { iso: value, date: startOfMonth(parsed) }
    }
  }
  const today = startOfMonth(new Date())
  return { iso: format(today, 'yyyy-MM'), date: today }
}

async function loadInvoiceDetail(invoiceId: string): Promise<InvoiceDetail | null> {
  try {
    return await getInvoiceDetail(invoiceId)
  } catch (error) {
    if (error instanceof InvoiceNotFoundError) return null
    throw error
  }
}

/**
 * Invoices route. v3: no per-customer filtering, no ledger status filter.
 * Reads `billingMonth` (YYYY-MM) and `id` (UUID) from searchParams, then
 * fetches everything the two panels need — invoiceable orders for the
 * Generate panel, the ledger rows for the right panel, and (when selected)
 * the invoice detail — in parallel.
 */
export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const billingMonth = parseBillingMonth(searchParams.billingMonth)
  const selectedInvoiceId = isUuid(searchParams.id) ? searchParams.id : null

  const [orders, invoices, detail] = await Promise.all([
    getInvoiceableOrders(billingMonth.date),
    getInvoices(),
    selectedInvoiceId ? loadInvoiceDetail(selectedInvoiceId) : Promise.resolve(null),
  ])

  return (
    <PageTransition>
      <InvoiceLayout
        orders={orders}
        billingMonth={billingMonth.iso}
        invoices={invoices}
        selectedInvoiceId={selectedInvoiceId}
        detail={detail}
      />
    </PageTransition>
  )
}
