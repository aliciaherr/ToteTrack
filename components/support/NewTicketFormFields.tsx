'use client'

/**
 * Presentational field sub-components for NewTicketForm. Extracted to keep
 * NewTicketForm.tsx under the 200-line CQ-02 component cap — same pattern
 * as LeadFormFields.tsx and GenerateInvoiceParts.tsx.
 */

import { useRef, type ChangeEvent } from 'react'
import type { FieldErrors, UseFormRegister } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES } from '@/lib/actions/support.constants'
import type { TicketFormValues } from './ticketFormSchema'
import { categoryLabel, priorityLabel } from './ticketBadgeStyles'

const FORM_INPUT_CLASS =
  'w-full h-11 px-3 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground'

type FieldProps = {
  register: UseFormRegister<TicketFormValues>
  errors: FieldErrors<TicketFormValues>
}

export function TitleField({ register, errors }: FieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wide text-muted-foreground">Issue Title *</label>
      <input
        type="text"
        className={FORM_INPUT_CLASS}
        placeholder="Short summary of the issue"
        {...register('title', { required: 'Title is required.' })}
      />
      {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
    </div>
  )
}

export function CategoryPriorityRow({ register }: Pick<FieldProps, 'register'>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Category</label>
        <select className={FORM_INPUT_CLASS} {...register('category')}>
          {SUPPORT_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {categoryLabel(value)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Priority</label>
        <select className={FORM_INPUT_CLASS} {...register('priority')}>
          {SUPPORT_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {priorityLabel(value)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function DescriptionField({ register, errors }: FieldProps) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wide text-muted-foreground">
        Detailed Description *
      </label>
      <textarea
        rows={6}
        className="w-full p-3 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground resize-y"
        placeholder="Steps to reproduce, expected vs. actual, anything helpful"
        {...register('description', { required: 'Description is required.' })}
      />
      {errors.description && (
        <p className="text-xs text-destructive">{errors.description.message}</p>
      )}
    </div>
  )
}

interface AttachmentsFieldProps {
  files: File[]
  onAdd: (event: ChangeEvent<HTMLInputElement>) => void
  onRemove: (index: number) => void
  error: string | null
}

export function AttachmentsField({ files, onAdd, onRemove, error }: AttachmentsFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-2">
      <label className="text-xs uppercase tracking-wide text-muted-foreground">Attachments</label>
      <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center space-y-2">
        <p className="text-xs text-muted-foreground">PNG, JPG, or PDF up to 5MB — maximum 3 files.</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,application/pdf"
          aria-label="Attach files"
          onChange={(event) => {
            onAdd(event)
            event.target.value = ''
          }}
          className="sr-only"
        />
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {files.length > 0 && (
        <ul role="list" className="space-y-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-xs"
            >
              <span className="truncate" title={file.name}>{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onRemove(index)}
                className="text-muted-foreground hover:text-destructive min-h-[32px] min-w-[32px]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
