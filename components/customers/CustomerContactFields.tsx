'use client'

import { Trash2 } from 'lucide-react'
import {
  type UseFieldArrayReturn,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
  type FieldErrors,
} from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, type CustomerFormValues } from './customerFormSchema'
import { MAX_CONTACTS_PER_CUSTOMER } from '@/lib/actions/customers.constants'

interface CustomerContactFieldsProps {
  fieldArray: UseFieldArrayReturn<CustomerFormValues, 'contacts', 'key'>
  register: UseFormRegister<CustomerFormValues>
  setValue: UseFormSetValue<CustomerFormValues>
  watch: UseFormWatch<CustomerFormValues>
  errors: FieldErrors<CustomerFormValues>
}

function ContactError({ message }: { message: string | undefined }) {
  if (!message) return null
  return <p className="text-xs text-destructive">{message}</p>
}

function validateName(value: string): true | string {
  return value.trim() !== '' || 'Contact name is required.'
}

interface ContactRowProps {
  index: number
  isPrimary: boolean
  canRemove: boolean
  register: UseFormRegister<CustomerFormValues>
  onSelectPrimary: (index: number) => void
  onRemove: (index: number) => void
  errors: FieldErrors<CustomerFormValues>
}

function ContactRow({
  index,
  isPrimary,
  canRemove,
  register,
  onSelectPrimary,
  onRemove,
  errors,
}: ContactRowProps) {
  return (
    <div className="rounded-lg border border-border p-3 space-y-2 bg-card">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-secondary">
          <input
            type="radio"
            checked={isPrimary}
            onChange={() => onSelectPrimary(index)}
            className="h-4 w-4"
            aria-label={`Mark contact ${index + 1} as primary`}
          />
          Primary
        </label>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemove(index)}
            className="min-h-[32px] text-destructive"
            aria-label={`Remove contact ${index + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="space-y-1">
          <input
            {...register(`contacts.${index}.name`, { validate: validateName })}
            placeholder="Name"
            aria-label={`Contact ${index + 1} name`}
            className={FORM_INPUT_CLASS}
          />
          <ContactError message={errors.contacts?.[index]?.name?.message} />
        </div>
        <input
          {...register(`contacts.${index}.role`)}
          placeholder="Role (optional)"
          aria-label={`Contact ${index + 1} role`}
          className={FORM_INPUT_CLASS}
        />
        <div className="space-y-1">
          <input
            {...register(`contacts.${index}.email`)}
            type="email"
            placeholder="Email (optional)"
            aria-label={`Contact ${index + 1} email`}
            className={FORM_INPUT_CLASS}
          />
          <ContactError message={errors.contacts?.[index]?.email?.message} />
        </div>
        <input
          {...register(`contacts.${index}.phone`)}
          placeholder="Phone (optional)"
          aria-label={`Contact ${index + 1} phone`}
          className={FORM_INPUT_CLASS}
        />
      </div>
    </div>
  )
}

/**
 * Contacts repeater section for the customer form. One primary contact is
 * always selected; clicking another radio flips it. Up to
 * MAX_CONTACTS_PER_CUSTOMER contacts, at least one required. Removing the
 * current primary auto-promotes contact[0].
 */
export default function CustomerContactFields({
  fieldArray,
  register,
  setValue,
  watch,
  errors,
}: CustomerContactFieldsProps) {
  const { fields, append, remove } = fieldArray
  const contactsLive = watch('contacts') ?? []

  function selectPrimary(selectedIndex: number) {
    fields.forEach((_, index) => {
      setValue(`contacts.${index}.is_primary`, index === selectedIndex, { shouldDirty: true })
    })
  }

  function addContact() {
    if (fields.length >= MAX_CONTACTS_PER_CUSTOMER) return
    append({ name: '', role: '', email: '', phone: '', is_primary: false })
  }

  function removeContact(index: number) {
    const wasPrimary = contactsLive[index]?.is_primary ?? fields[index]?.is_primary
    remove(index)
    if (wasPrimary && fields.length > 1) {
      setValue('contacts.0.is_primary', true, { shouldDirty: true })
    }
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
        Contacts
      </legend>
      {errors.contacts?.root?.message && (
        <p className="text-xs text-destructive" role="alert">
          {errors.contacts.root.message}
        </p>
      )}
      {fields.map((field, index) => (
        <ContactRow
          key={field.key}
          index={index}
          isPrimary={contactsLive[index]?.is_primary ?? field.is_primary}
          canRemove={fields.length > 1}
          register={register}
          onSelectPrimary={selectPrimary}
          onRemove={removeContact}
          errors={errors}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={addContact}
        disabled={fields.length >= MAX_CONTACTS_PER_CUSTOMER}
        className="min-h-[44px]"
      >
        + Add another contact
      </Button>
    </fieldset>
  )
}
