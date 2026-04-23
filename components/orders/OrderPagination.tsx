'use client'

import Link from 'next/link'
import { ORDERS_PAGE_SIZE } from '@/db/queries/orders.constants'
import type { OrderListStatus } from '@/db/queries/orders'

interface OrderPaginationProps {
  totalCount: number
  totalPages: number
  currentPage: number
  status: OrderListStatus
  selectedId: string | null
}

function buildPageHref(
  page: number,
  status: OrderListStatus,
  selectedId: string | null,
): string {
  const params = new URLSearchParams()
  if (status !== 'all') params.set('status', status)
  if (page > 1) params.set('page', String(page))
  if (selectedId) params.set('id', selectedId)
  const query = params.toString()
  return query ? `/orders?${query}` : '/orders'
}

const CONTROL_BASE =
  'min-h-[44px] inline-flex items-center px-3 text-sm rounded-md border border-border'

function PaginationControl({
  href,
  label,
  ariaLabel,
}: {
  href: string | null
  label: string
  ariaLabel: string
}) {
  if (!href) {
    return (
      <span
        aria-disabled="true"
        aria-label={ariaLabel}
        className={`${CONTROL_BASE} text-muted-foreground opacity-50`}
      >
        {label}
      </span>
    )
  }
  return (
    <Link href={href} aria-label={ariaLabel} className={`${CONTROL_BASE} hover:bg-muted`}>
      {label}
    </Link>
  )
}

export default function OrderPagination({
  totalCount,
  totalPages,
  currentPage,
  status,
  selectedId,
}: OrderPaginationProps) {
  const fromRow = (currentPage - 1) * ORDERS_PAGE_SIZE + 1
  const toRow = Math.min(currentPage * ORDERS_PAGE_SIZE, totalCount)

  const prevHref =
    currentPage > 1 ? buildPageHref(currentPage - 1, status, selectedId) : null
  const nextHref =
    currentPage < totalPages ? buildPageHref(currentPage + 1, status, selectedId) : null

  return (
    <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-3 bg-card">
      <span className="text-sm text-muted-foreground">
        Showing {fromRow}–{toRow} of {totalCount} orders
      </span>
      <div className="flex items-center gap-2">
        <PaginationControl href={prevHref} label="Previous" ariaLabel="Previous page" />
        <PaginationControl href={nextHref} label="Next" ariaLabel="Next page" />
      </div>
    </div>
  )
}
