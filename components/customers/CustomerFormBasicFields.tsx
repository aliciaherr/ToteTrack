'use client'

import {
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from 'react-hook-form'
import { FORM_INPUT_CLASS, type CustomerFormValues } from './customerFormSchema'

interface CustomerFormBasicFieldsProps {
  isEdit: boolean
  register: UseFormRegister<CustomerFormValues>
  setValue: UseFormSetValue<CustomerFormValues>
  watch: UseFormWatch<CustomerFormValues>
  errors: FieldErrors<CustomerFormValues>
}

const LABEL_CLASS = 'text-xs uppercase tracking-wide text-muted-foreground'
const STATUS_OPTIONS = ['active', 'inactive'] as const

function validateFrequency(value: string): true | string {
  if (!value.trim()) return true
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 'Contact frequency must be greater than 0.'
  }
  return true
}

function StatusToggle({
  selected,
  onSelect,
}: {
  selected: 'active' | 'inactive'
  onSelect: (next: 'active' | 'inactive') => void
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {STATUS_OPTIONS.map((option) => {
        const isSelected = selected === option
        return (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className={`min-h-[44px] px-4 text-sm capitalize ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-card text-secondary hover:bg-muted'}`}
            aria-pressed={isSelected}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Scalar fields for the customer form: company name, status (edit only),
 * contact frequency, and notes. Contacts repeater is rendered separately by
 * the parent CustomerForm.
 */
export default function CustomerFormBasicFields({
  isEdit,
  register,
  setValue,
  watch,
  errors,
}: CustomerFormBasicFieldsProps) {
  return (
    <>
      <div className="space-y-1">
        <label className={LABEL_CLASS} htmlFor="company_name">Company Name</label>
        <input
          id="company_name"
          {...register('company_name', { required: 'Company name is required.' })}
          className={FORM_INPUT_CLASS}
          autoFocus
        />
        {errors.company_name && (
          <p className="text-xs text-destructive">{errors.company_name.message}</p>
        )}
      </div>

      {isEdit && (
        <div className="space-y-1">
          <span className={LABEL_CLASS}>Status</span>
          <StatusToggle
            selected={watch('status')}
            onSelect={(next) => setValue('status', next, { shouldDirty: true })}
          />
        </div>
      )}

      <div className="space-y-1">
        <label className={LABEL_CLASS} htmlFor="contact_frequency_days">
          Contact Frequency (days, leave blank for auto)
        </label>
        <input
          id="contact_frequency_days"
          type="number"
          min={1}
          {...register('contact_frequency_days', { validate: validateFrequency })}
          className={FORM_INPUT_CLASS}
        />
        {errors.contact_frequency_days && (
          <p className="text-xs text-destructive">{errors.contact_frequency_days.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className={LABEL_CLASS} htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          rows={3}
          {...register('notes')}
          className={`${FORM_INPUT_CLASS} h-auto py-2`}
        />
      </div>
    </>
  )
}
