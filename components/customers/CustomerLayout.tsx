'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import CustomerList from './CustomerList'
import CustomerDetail, { CustomerDetailEmptyState } from './CustomerDetail'
import CustomerForm from './CustomerForm'
import DetailDrawer from '@/components/shell/DetailDrawer'
import type {
  CustomerDetail as CustomerDetailType,
  CustomerListRow,
  CustomerListSort,
  CustomerListStatus,
  CustomerOrderRow,
  CustomerOrdersWindow,
  VolumeOverview,
} from '@/db/queries/customers'

export type CustomerLayoutInitialMode = 'detail' | 'new-customer'

interface CustomerLayoutProps {
  customers: CustomerListRow[]
  selectedId: string | null
  status: CustomerListStatus
  search: string
  sort: CustomerListSort
  detail: CustomerDetailType | null
  orders: CustomerOrderRow[]
  window: CustomerOrdersWindow
  volumeOverview: VolumeOverview
  initialMode?: CustomerLayoutInitialMode
}

type RightPanelMode = 'detail' | 'new-customer' | 'edit-customer'

/**
 * Two-panel layout for the Customers screen. The left panel is the
 * searchable/sortable customer list; the right panel switches between three
 * modes: the customer detail view (default), the New Customer form, and the
 * Edit Customer form. Save/delete handlers navigate and refresh so the list
 * re-renders with the latest data.
 */
export default function CustomerLayout({
  customers,
  selectedId,
  status,
  search,
  sort,
  detail,
  orders,
  window,
  volumeOverview,
  initialMode = 'detail',
}: CustomerLayoutProps) {
  const router = useRouter()
  const [mode, setMode] = useState<RightPanelMode>(initialMode)
  const openNewCustomer = useCallback(() => setMode('new-customer'), [])
  const openEditCustomer = useCallback(() => setMode('edit-customer'), [])
  const closePanel = useCallback(() => setMode('detail'), [])

  const handleSaved = useCallback(() => {
    setMode('detail')
    router.refresh()
  }, [router])

  const handleDeleted = useCallback(() => {
    setMode('detail')
    router.push('/customers')
  }, [router])

  // Drawer is "open" below lg whenever the right panel has content the user
  // would want to see — a selection or an active form. Closing it returns to
  // the list view with no selection and no form.
  const isDrawerOpen = mode !== 'detail' || !!detail
  const handleDrawerClose = useCallback(() => {
    setMode('detail')
    if (selectedId) router.push('/customers')
  }, [router, selectedId])

  const renderRightPanel = () => {
    if (mode === 'new-customer') {
      return (
        <CustomerForm
          mode="create"
          onClose={closePanel}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )
    }
    if (mode === 'edit-customer' && detail) {
      return (
        <CustomerForm
          mode="edit"
          initialDetail={detail}
          onClose={closePanel}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )
    }
    if (!detail) return <CustomerDetailEmptyState />
    return (
      <CustomerDetail
        detail={detail}
        orders={orders}
        window={window}
        volumeOverview={volumeOverview}
        onEdit={openEditCustomer}
      />
    )
  }

  return (
    <div className="h-[calc(100vh-0.75rem)] lg:grid lg:grid-cols-[minmax(320px,35%)_1fr] lg:grid-rows-[minmax(0,1fr)]">
      <CustomerList
        customers={customers}
        selectedId={selectedId}
        status={status}
        search={search}
        sort={sort}
        onNewCustomer={openNewCustomer}
      />
      <DetailDrawer
        isOpen={isDrawerOpen}
        onClose={handleDrawerClose}
        ariaLabel="Customer detail"
      >
        {renderRightPanel()}
      </DetailDrawer>
    </div>
  )
}
