'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import PickupTable from './PickupTable'
import PickupDetail from './PickupDetail'
import PickupForm from './PickupForm'
import DetailDrawer from '@/components/shell/DetailDrawer'
import type {
  PickupDetail as PickupDetailType,
  PickupListStatus,
  PickupTableRow,
} from '@/db/queries/pickups'
import type { CustomerSelectOption } from '@/db/queries/customers'

export type PickupLayoutInitialMode = 'detail' | 'new-pickup'

interface PickupLayoutProps {
  pickups: PickupTableRow[]
  status: PickupListStatus
  search: string
  selectedId: string | null
  detail: PickupDetailType | null
  customers: CustomerSelectOption[]
  initialMode: PickupLayoutInitialMode
  lockedCustomerId: string | null
}

type RightPanelMode = 'detail' | 'new-pickup' | 'edit-pickup'

/**
 * Two-panel shell for the Pickups screen. Left: the pickups table (status tabs
 * + search). Right: the pickup detail view, the New Pickup form, or the Edit
 * Pickup form. The New-Pickup mode can be initialized from the URL (`?new=1`)
 * for deep links from the nav's quick-add and from `CustomerDetail`.
 */
export default function PickupLayout({
  pickups,
  status,
  search,
  selectedId,
  detail,
  customers,
  initialMode,
  lockedCustomerId,
}: PickupLayoutProps) {
  const router = useRouter()
  const [mode, setMode] = useState<RightPanelMode>(initialMode)
  const openNewPickup = useCallback(() => setMode('new-pickup'), [])
  const openEditPickup = useCallback(() => setMode('edit-pickup'), [])
  const closePanel = useCallback(() => setMode('detail'), [])

  const handleSaved = useCallback(() => {
    setMode('detail')
    router.refresh()
  }, [router])

  const renderRightPanel = () => {
    if (mode === 'new-pickup') {
      return (
        <PickupForm
          mode="create"
          customers={customers}
          lockedCustomerId={lockedCustomerId}
          onClose={closePanel}
          onSaved={handleSaved}
        />
      )
    }
    if (mode === 'edit-pickup' && detail) {
      return (
        <PickupForm
          mode="edit"
          initialDetail={detail}
          customers={customers}
          lockedCustomerId={null}
          onClose={closePanel}
          onSaved={handleSaved}
        />
      )
    }
    return <PickupDetail detail={detail} onEdit={detail ? openEditPickup : undefined} />
  }

  const isDrawerOpen = mode !== 'detail' || !!detail
  const handleDrawerClose = useCallback(() => {
    setMode('detail')
    if (selectedId) router.push('/pickups')
  }, [router, selectedId])

  return (
    <div className="h-[calc(100svh-0.75rem)] lg:grid lg:grid-cols-[1fr_minmax(320px,35%)] lg:grid-rows-[minmax(0,1fr)]">
      <PickupTable
        pickups={pickups}
        status={status}
        search={search}
        selectedId={selectedId}
        onNewPickup={openNewPickup}
      />
      <DetailDrawer
        isOpen={isDrawerOpen}
        onClose={handleDrawerClose}
        ariaLabel="Pickup detail"
      >
        {renderRightPanel()}
      </DetailDrawer>
    </div>
  )
}
