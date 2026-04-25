'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import LeadList from './LeadList'
import LeadDetail, { LeadDetailEmptyState } from './LeadDetail'
import LeadForm from './LeadForm'
import ConvertLeadDialog from './ConvertLeadDialog'
import DetailDrawer from '@/components/shell/DetailDrawer'
import type { LeadDetail as LeadDetailType, LeadListRow, LeadListStatus, LeadNote } from '@/db/queries/leads'

export type LeadLayoutInitialMode = 'detail' | 'new-lead'

interface LeadLayoutProps {
  leads: LeadListRow[]
  selectedId: string | null
  status: LeadListStatus
  search: string
  detail: LeadDetailType | null
  notes: LeadNote[]
  initialMode?: LeadLayoutInitialMode
}

type RightPanelMode = 'detail' | 'new-lead' | 'edit-lead'

/**
 * Two-panel shell for the Leads screen. Left: filterable/searchable lead list.
 * Right: lead detail, new-lead form, or edit-lead form.
 * ConvertLeadDialog overlays the right panel when conversion is triggered.
 */
export default function LeadLayout({
  leads,
  selectedId,
  status,
  search,
  detail,
  notes,
  initialMode = 'detail',
}: LeadLayoutProps) {
  const router = useRouter()
  const [mode, setMode] = useState<RightPanelMode>(initialMode)
  const [showConvertDialog, setShowConvertDialog] = useState(false)

  const openNew = useCallback(() => setMode('new-lead'), [])
  const openEdit = useCallback(() => setMode('edit-lead'), [])
  const closeForm = useCallback(() => setMode('detail'), [])

  const handleSaved = useCallback(() => {
    setMode('detail')
    router.refresh()
  }, [router])

  const handleConverted = useCallback(() => {
    // ConvertLeadDialog redirects to /customers on success — nothing to clean up here.
    setShowConvertDialog(false)
  }, [])

  const renderRightPanel = () => {
    if (mode === 'new-lead') {
      return <LeadForm mode="create" onClose={closeForm} onSaved={handleSaved} />
    }
    if (mode === 'edit-lead' && detail) {
      return (
        <LeadForm mode="edit" initialDetail={detail} onClose={closeForm} onSaved={handleSaved} />
      )
    }
    if (!detail) return <LeadDetailEmptyState />
    return (
      <LeadDetail
        detail={detail}
        notes={notes}
        onEdit={openEdit}
        onConvert={() => setShowConvertDialog(true)}
      />
    )
  }

  const isDrawerOpen = mode !== 'detail' || !!detail
  const handleDrawerClose = useCallback(() => {
    setMode('detail')
    if (selectedId) router.push('/leads')
  }, [router, selectedId])

  return (
    <div className="h-[calc(100vh-0.75rem)] lg:grid lg:grid-cols-[minmax(320px,38%)_1fr] lg:grid-rows-[minmax(0,1fr)]">
      <LeadList
        leads={leads}
        selectedId={selectedId}
        status={status}
        search={search}
        onNew={openNew}
      />
      <DetailDrawer
        isOpen={isDrawerOpen}
        onClose={handleDrawerClose}
        ariaLabel="Lead detail"
      >
        {renderRightPanel()}
        {detail && (
          <ConvertLeadDialog
            open={showConvertDialog}
            leadId={detail.id}
            leadName={detail.name}
            onCancel={() => setShowConvertDialog(false)}
          />
        )}
      </DetailDrawer>
    </div>
  )
}
