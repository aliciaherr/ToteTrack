import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useForm } from 'react-hook-form'

// useOrderForm (source of the MRU pre-selection hook) imports the server
// actions module; stub it so the test never touches '@/db'.
vi.mock('@/lib/actions/orders', () => ({
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
}))

import AddressSelect from '../AddressSelect'
import { useMruAddressPreselect } from '../useOrderForm'
import { EMPTY_FORM_VALUES, type OrderFormValues } from '../orderFormSchema'
import type { CustomerSelectOption } from '@/db/queries/customers'

const ACME_ID = '22222222-2222-2222-2222-222222222222'
const BETA_ID = '33333333-3333-3333-3333-333333333333'
const MRU_ADDRESS_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

const acme: CustomerSelectOption = {
  id: ACME_ID,
  company_name: 'Acme Industrial',
  addresses: [
    { id: MRU_ADDRESS_ID, address: '500 Dock Road' },
    { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', address: '9 Older Lane' },
  ],
}

const beta: CustomerSelectOption = {
  id: BETA_ID,
  company_name: 'Beta Co',
  addresses: [],
}

// Minimal stand-in for the real prop flow: useOrderForm runs the MRU
// pre-selection, OrderFormFields resolves the selected customer's addresses,
// AddressSelect renders them. The <output> probes expose the two bridged form
// values so tests can assert what would be submitted.
function Harness({
  customers,
  mode = 'create',
  initialValues,
}: {
  customers: CustomerSelectOption[]
  mode?: 'create' | 'edit'
  initialValues?: Partial<OrderFormValues>
}) {
  const form = useForm<OrderFormValues>({
    defaultValues: { ...EMPTY_FORM_VALUES, ...initialValues },
  })
  useMruAddressPreselect(form, mode, customers)
  const selected = customers.find((c) => c.id === form.watch('customer_id'))
  return (
    <>
      <AddressSelect
        addresses={selected?.addresses ?? []}
        register={form.register}
        watch={form.watch}
        setValue={form.setValue}
      />
      <output data-testid="address-value">{form.watch('delivery_address')}</output>
      <output data-testid="address-id-value">{form.watch('delivery_address_id') ?? 'null'}</output>
    </>
  )
}

describe('AddressSelect', () => {
  it('pre-selects the MRU address and populates the field', () => {
    render(<Harness customers={[acme]} initialValues={{ customer_id: ACME_ID }} />)
    // First entry of the pre-sorted list is the MRU — selected without typing.
    expect(screen.getByLabelText(/^Delivery Address$/i)).toHaveDisplayValue('500 Dock Road')
    expect(screen.getByTestId('address-value')).toHaveTextContent('500 Dock Road')
    expect(screen.getByTestId('address-id-value')).toHaveTextContent(MRU_ADDRESS_ID)
  })

  it('shows only the add-new textarea when the address list is empty', () => {
    render(<Harness customers={[beta]} initialValues={{ customer_id: BETA_ID }} />)
    // Zero saved addresses → straight to free-text entry, no dropdown at all.
    expect(screen.queryByRole('combobox')).toBeNull()
    const field = screen.getByLabelText(/^Delivery Address$/i)
    expect(field.tagName).toBe('TEXTAREA')
    expect(field).toHaveValue('')
    // And no way "back" to a dropdown that has nothing to offer.
    expect(screen.queryByRole('button', { name: /use a saved address/i })).toBeNull()
  })

  it('swaps to a textarea and nulls the saved-address id on "+ Add new address"', () => {
    render(<Harness customers={[acme]} initialValues={{ customer_id: ACME_ID }} />)
    const addNew = screen.getByRole('option', { name: /add new address/i }) as HTMLOptionElement
    fireEvent.change(screen.getByLabelText(/^Delivery Address$/i), {
      target: { value: addNew.value },
    })
    const textarea = screen.getByLabelText(/^Delivery Address$/i)
    expect(textarea.tagName).toBe('TEXTAREA')
    fireEvent.change(textarea, { target: { value: '77 Fresh Street' } })
    expect(screen.getByTestId('address-value')).toHaveTextContent('77 Fresh Street')
    expect(screen.getByTestId('address-id-value')).toHaveTextContent('null')
  })

  it('returns to the saved-address dropdown from add-new mode', () => {
    render(<Harness customers={[acme]} initialValues={{ customer_id: ACME_ID }} />)
    const addNew = screen.getByRole('option', { name: /add new address/i }) as HTMLOptionElement
    fireEvent.change(screen.getByLabelText(/^Delivery Address$/i), {
      target: { value: addNew.value },
    })
    fireEvent.click(screen.getByRole('button', { name: /use a saved address/i }))
    // Back in the dropdown with the MRU restored — nothing typed is lost that
    // mattered (add-new had cleared the field).
    expect(screen.getByLabelText(/^Delivery Address$/i)).toHaveDisplayValue('500 Dock Road')
    expect(screen.getByTestId('address-id-value')).toHaveTextContent(MRU_ADDRESS_ID)
  })

  it('displays the stored snapshot as "Current:" when it matches no saved address', () => {
    // Edit mode: the order carries a point-in-time snapshot that predates the
    // address book. It must display as selected without being corrupted, and
    // keep delivery_address_id null so an unchanged resubmit stays snapshot-only.
    render(
      <Harness
        customers={[acme]}
        mode="edit"
        initialValues={{
          customer_id: ACME_ID,
          delivery_address: 'Old Warehouse 7',
          delivery_address_id: null,
        }}
      />,
    )
    expect(screen.getByLabelText(/^Delivery Address$/i)).toHaveDisplayValue(
      'Current: Old Warehouse 7',
    )
    expect(screen.getByTestId('address-value')).toHaveTextContent('Old Warehouse 7')
    expect(screen.getByTestId('address-id-value')).toHaveTextContent('null')
  })
})
