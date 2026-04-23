'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import OrderTable from './OrderTable'
import OrderDetail from './OrderDetail'
import OrderForm from './OrderForm'
import DetailDrawer from '@/components/shell/DetailDrawer'
import type {
  OrderDetail as OrderDetailType,
  OrderListStatus,
  OrderTableRow,
} from '@/db/queries/orders'
import type { CustomerSelectOption } from '@/db/queries/customers'

export type OrderLayoutInitialMode = 'detail' | 'new-order'

interface OrderLayoutProps {
  orders: OrderTableRow[]
  totalCount: number
  totalPages: number
  currentPage: number
  status: OrderListStatus
  selectedId: string | null
  detail: OrderDetailType | null
  customers: CustomerSelectOption[]
  initialMode: OrderLayoutInitialMode
  lockedCustomerId: string | null
}

type RightPanelMode = 'detail' | 'new-order' | 'edit-order'

/**
 * Two-panel shell for the Orders screen. Left: orders table (status tabs +
 * pagination). Right: the order detail view (Task 16), the New Order form
 * (Task 17 create mode), or the Edit Order form (Task 17 edit mode). The
 * New-Order mode can be initialized from the URL (`?new=1`) for deep links
 * from `CustomerDetail`'s "+ New Order" button.
 */
export default function OrderLayout({
  orders,
  totalCount,
  totalPages,
  currentPage,
  status,
  selectedId,
  detail,
  customers,
  initialMode,
  lockedCustomerId,
}: OrderLayoutProps) {
  const router = useRouter()
  const [mode, setMode] = useState<RightPanelMode>(initialMode)
  const openNewOrder = useCallback(() => setMode('new-order'), [])
  const openEditOrder = useCallback(() => setMode('edit-order'), [])
  const closePanel = useCallback(() => setMode('detail'), [])

  const handleSaved = useCallback(() => {
    setMode('detail')
    router.refresh()
  }, [router])

  const renderRightPanel = () => {
    if (mode === 'new-order') {
      return (
        <OrderForm
          mode="create"
          customers={customers}
          lockedCustomerId={lockedCustomerId}
          onClose={closePanel}
          onSaved={handleSaved}
        />
      )
    }
    if (mode === 'edit-order' && detail) {
      return (
        <OrderForm
          mode="edit"
          initialDetail={detail}
          customers={customers}
          lockedCustomerId={null}
          onClose={closePanel}
          onSaved={handleSaved}
        />
      )
    }
    return <OrderDetail detail={detail} onEdit={detail ? openEditOrder : undefined} />
  }

  const isDrawerOpen = mode !== 'detail' || !!detail
  const handleDrawerClose = useCallback(() => {
    setMode('detail')
    if (selectedId) router.push('/orders')
  }, [router, selectedId])

  return (
    <div className="h-[calc(100vh-3.5rem)] lg:grid lg:grid-cols-[1fr_minmax(320px,35%)]">
      <OrderTable
        orders={orders}
        totalCount={totalCount}
        totalPages={totalPages}
        currentPage={currentPage}
        status={status}
        selectedId={selectedId}
        onNewOrder={openNewOrder}
      />
      <DetailDrawer
        isOpen={isDrawerOpen}
        onClose={handleDrawerClose}
        ariaLabel="Order detail"
      >
        {renderRightPanel()}
      </DetailDrawer>
    </div>
  )
}
