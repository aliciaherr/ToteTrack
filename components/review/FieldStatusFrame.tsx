'use client'

import { AlertCircle, CheckCircle2 } from 'lucide-react'
import type { FieldStatus } from './reviewPane.helpers'

const FRAME_CLASS: Record<FieldStatus, string> = {
  confident: 'border-success',
  attention: 'border-destructive',
  neutral: 'border-transparent',
}

/** Read by assistive tech, so colour is never the only signal. */
export const STATUS_TEXT: Record<FieldStatus, string> = {
  confident: 'Read with confidence',
  attention: 'Needs attention',
  neutral: 'Edited',
}

function StatusIcon({ status }: { status: FieldStatus }) {
  if (status === 'neutral') return null
  const Icon = status === 'confident' ? CheckCircle2 : AlertCircle
  const tone = status === 'confident' ? 'text-success' : 'text-destructive'
  return <Icon className={`absolute right-2 top-2 size-4 ${tone}`} aria-hidden="true" />
}

/**
 * The review pane's status border around one field group (Task 119): green
 * with ✓ when the field was read with confidence, red with ! when it is empty
 * or flagged, plain once the salesperson has edited it. A frame, so the order
 * form's own parts render inside it unchanged.
 */
export default function FieldStatusFrame({ status, children }: { status: FieldStatus; children: React.ReactNode }) {
  return (
    <div data-status={status} className={`relative space-y-2 rounded-md border-2 p-2 ${FRAME_CLASS[status]}`}>
      <StatusIcon status={status} />
      <span className="sr-only">{STATUS_TEXT[status]}</span>
      {children}
    </div>
  )
}
