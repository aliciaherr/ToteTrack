'use client'

/**
 * Presentational field sub-components for LeadForm. Extracted to keep
 * LeadForm.tsx under the 200-line CQ-02 component cap — same pattern as
 * leads.convert.ts. Each sub-component is a thin wrapper around a labelled
 * input registered with react-hook-form; none hold state of their own.
 */

import type { FieldErrors, UseFormRegister } from 'react-hook-form'
import { type LeadFormValues, FORM_INPUT_CLASS } from './leadFormSchema'

export const STATUS_OPTIONS = [
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
] as const

export const ACTION_TYPE_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'visit', label: 'Visit' },
  { value: 'other', label: 'Other' },
]

type FieldProps = {
  register: UseFormRegister<LeadFormValues>
  errors: FieldErrors<LeadFormValues>
}

export function NameField({ register, errors }: FieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wide text-muted-foreground">Name *</label>
      <input
        type="text"
        className={FORM_INPUT_CLASS}
        placeholder="Full name"
        {...register('name', { required: 'Name is required.' })}
      />
      {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
    </div>
  )
}

export function CompanyTitleRow({ register }: Pick<FieldProps, 'register'>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Company</label>
        <input type="text" className={FORM_INPUT_CLASS} placeholder="Company name" {...register('company')} />
      </div>
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Title</label>
        <input type="text" className={FORM_INPUT_CLASS} placeholder="Job title" {...register('title')} />
      </div>
    </div>
  )
}

export function ContactMethodRow({ register, errors }: FieldProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Email</label>
        <input
          type="email"
          className={FORM_INPUT_CLASS}
          placeholder="email@example.com (optional)"
          {...register('email')}
        />
        {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
      </div>
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Phone</label>
        <input
          type="tel"
          className={FORM_INPUT_CLASS}
          placeholder="Phone number (optional)"
          {...register('phone')}
        />
      </div>
    </div>
  )
}

export function StatusSourceRow({ register }: Pick<FieldProps, 'register'>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Status</label>
        <select className={FORM_INPUT_CLASS} {...register('status')}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Lead Source</label>
        <input type="text" className={FORM_INPUT_CLASS} placeholder="e.g. Referral" {...register('lead_source')} />
      </div>
    </div>
  )
}

export function FollowUpRow({ register }: Pick<FieldProps, 'register'>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Follow-up Date</label>
        <input type="date" className={FORM_INPUT_CLASS} {...register('next_follow_up_date')} />
      </div>
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Action Type</label>
        <select className={FORM_INPUT_CLASS} {...register('next_action_type')}>
          {ACTION_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
