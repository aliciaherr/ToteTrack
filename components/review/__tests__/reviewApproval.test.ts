import { describe, it, expect } from 'vitest'
import { EMPTY_FORM_VALUES, type OrderFormValues } from '@/components/orders/orderFormSchema'
import { approvalProblems } from '../reviewApproval'
import { ACME } from './reviewFields.fixture'

function complete(overrides: Partial<OrderFormValues> = {}): OrderFormValues {
  return {
    ...EMPTY_FORM_VALUES,
    po_number: 'PO-4471',
    customer_id: ACME,
    delivery_address: '1 Acme Way',
    qty_275_recon: 10,
    unit_price_275_recon: '100.00',
    ...overrides,
  }
}

describe('approvalProblems', () => {
  it('passes a complete form', () => {
    expect(approvalProblems(complete())).toEqual([])
  })

  it('reports a missing PO number', () => {
    expect(approvalProblems(complete({ po_number: '   ' }))).toEqual(['PO number is required.'])
  })

  it('reports a missing customer', () => {
    expect(approvalProblems(complete({ customer_id: '' }))).toEqual(['Please choose a customer.'])
  })

  it('reports a missing address unless the customer collects', () => {
    expect(approvalProblems(complete({ delivery_address: '' }))).toEqual([
      'Delivery address is required unless the customer collects.',
    ])
    expect(approvalProblems(complete({ delivery_address: '', customer_collects: true }))).toEqual([])
  })

  it('reports no quantity', () => {
    expect(approvalProblems(complete({ qty_275_recon: 0 }))).toEqual(['At least one quantity is required.'])
  })

  it('reports a quantity without a unit price', () => {
    const problems = approvalProblems(complete({ unit_price_275_recon: null }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^Unit price for .* is required/)
  })

  it('lists every problem at once, in form order', () => {
    expect(approvalProblems({ ...EMPTY_FORM_VALUES })).toEqual([
      'PO number is required.',
      'Please choose a customer.',
      'Delivery address is required unless the customer collects.',
      'At least one quantity is required.',
    ])
  })
})
