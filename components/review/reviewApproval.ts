import {
  firstUnitPriceCouplingError,
  totalQuantity,
  type OrderFormValues,
} from '@/components/orders/orderFormSchema'

/**
 * What blocks Approve on the review pane (Task 120), checked on the client so
 * an incomplete PO never reaches `approveReviewPo`. The wording matches the
 * New Order form and the server's `createOrderInputSchema`, so the reviewer
 * reads the same sentence whichever side catches it.
 *
 * @param values The review form's current values.
 * @returns One message per problem, in form order; empty when Approve can send.
 */
export function approvalProblems(values: OrderFormValues): string[] {
  const problems: string[] = []
  if (values.po_number.trim() === '') problems.push('PO number is required.')
  if (values.customer_id.trim() === '') problems.push('Please choose a customer.')
  if (!values.customer_collects && values.delivery_address.trim() === '') {
    problems.push('Delivery address is required unless the customer collects.')
  }
  if (totalQuantity(values) <= 0) {
    problems.push('At least one quantity is required.')
  } else {
    const priceProblem = firstUnitPriceCouplingError(values)
    if (priceProblem) problems.push(priceProblem)
  }
  return problems
}
