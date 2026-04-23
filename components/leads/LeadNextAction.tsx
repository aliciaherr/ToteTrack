'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { setNextAction } from '@/lib/actions/leads'
import type { LeadDetail } from '@/db/queries/leads'

interface LeadNextActionProps {
  leadId: string
  current: Pick<LeadDetail, 'next_follow_up_date' | 'next_action_type'>
  onSaved: () => void
}

const ACTION_TYPES = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'visit', label: 'Visit' },
  { value: 'other', label: 'Other' },
] as const

/**
 * Next-action setter for the lead detail panel. Lets the salesperson schedule
 * the next follow-up: date, time-of-day, and action type (call/email/visit/other).
 * Only `date` and `actionType` are persisted — the schema has no time column,
 * so `time` is collected for UX context only and dropped server-side.
 */
export default function LeadNextAction({ leadId, current, onSaved }: LeadNextActionProps) {
  const [date, setDate] = useState(current.next_follow_up_date ?? '')
  const [time, setTime] = useState('09:00')
  const [actionType, setActionType] = useState(current.next_action_type ?? 'call')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!date) {
      setError('Please select a date.')
      return
    }
    setError(null)
    setIsSubmitting(true)
    const result = await setNextAction(leadId, { date, time, actionType })
    setIsSubmitting(false)
    if ('error' in result) {
      setError(result.error)
    } else {
      onSaved()
    }
  }

  return (
    <section
      aria-label="Next action"
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Next Action</div>
      {error && (
        <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full h-10 text-sm bg-muted rounded-md border border-border px-2 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Time</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full h-10 text-sm bg-muted rounded-md border border-border px-2 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Action Type</span>
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
          className="w-full h-10 text-sm bg-muted rounded-md border border-border px-2 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {ACTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        onClick={handleSave}
        disabled={isSubmitting}
        className="w-full min-h-[44px]"
      >
        {isSubmitting ? 'Saving…' : 'Save Reminder'}
      </Button>
    </section>
  )
}
