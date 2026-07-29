import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CustomerAddresses from '../CustomerAddresses'

const mockAddCustomerAddress = vi.hoisted(() => vi.fn())
const mockUpdateCustomerAddress = vi.hoisted(() => vi.fn())
const mockDeleteCustomerAddress = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/customer-addresses', () => ({
  addCustomerAddress: mockAddCustomerAddress,
  updateCustomerAddress: mockUpdateCustomerAddress,
  deleteCustomerAddress: mockDeleteCustomerAddress,
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}))

const CUSTOMER_ID = '11111111-1111-1111-1111-111111111111'

const sampleAddresses = [
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', address: 'Dock 4, 1234 Industrial Blvd' },
  { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', address: '789 Commerce Pkwy' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CustomerAddresses', () => {
  it('renders the saved addresses in the given (MRU-first) order', () => {
    render(<CustomerAddresses customerId={CUSTOMER_ID} addresses={sampleAddresses} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Dock 4, 1234 Industrial Blvd')
    expect(items[1]).toHaveTextContent('789 Commerce Pkwy')
  })

  it('shows the empty state with an add affordance when there are no addresses', () => {
    render(<CustomerAddresses customerId={CUSTOMER_ID} addresses={[]} />)
    expect(screen.getByText(/no saved addresses yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add address/i })).toBeInTheDocument()
  })

  it('completes the add flow: textarea + save calls addCustomerAddress and refreshes', async () => {
    mockAddCustomerAddress.mockResolvedValueOnce({ id: 'new-address-id' })
    render(<CustomerAddresses customerId={CUSTOMER_ID} addresses={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /add address/i }))
    fireEvent.change(screen.getByLabelText(/new delivery address/i), {
      target: { value: '456 Harbor Rd, Long Beach, CA' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))

    await waitFor(() =>
      expect(mockAddCustomerAddress).toHaveBeenCalledWith(
        CUSTOMER_ID,
        '456 Harbor Rd, Long Beach, CA',
      ),
    )
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    expect(mockToast).toHaveBeenCalledWith('Address saved.', 'success')
  })

  it('surfaces the action error message when the add fails', async () => {
    mockAddCustomerAddress.mockResolvedValueOnce({ error: 'Address is required.' })
    render(<CustomerAddresses customerId={CUSTOMER_ID} addresses={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /add address/i }))
    fireEvent.change(screen.getByLabelText(/new delivery address/i), {
      target: { value: '   x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Address is required.')
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('completes the edit flow via updateCustomerAddress', async () => {
    mockUpdateCustomerAddress.mockResolvedValueOnce({ success: true })
    render(<CustomerAddresses customerId={CUSTOMER_ID} addresses={sampleAddresses} />)

    fireEvent.click(screen.getByRole('button', { name: /edit address: dock 4/i }))
    fireEvent.change(screen.getByLabelText(/edit address: dock 4/i), {
      target: { value: 'Dock 5, 1234 Industrial Blvd' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save address/i }))

    await waitFor(() =>
      expect(mockUpdateCustomerAddress).toHaveBeenCalledWith(
        sampleAddresses[0].id,
        'Dock 5, 1234 Industrial Blvd',
      ),
    )
    expect(mockToast).toHaveBeenCalledWith('Address updated.', 'success')
  })

  it('asks for confirmation before deleting and only calls the action on confirm', async () => {
    mockDeleteCustomerAddress.mockResolvedValueOnce({ success: true })
    render(<CustomerAddresses customerId={CUSTOMER_ID} addresses={sampleAddresses} />)

    fireEvent.click(screen.getByRole('button', { name: /delete address: 789 commerce/i }))
    expect(screen.getByText(/delete this address\?/i)).toBeInTheDocument()
    expect(mockDeleteCustomerAddress).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))
    await waitFor(() =>
      expect(mockDeleteCustomerAddress).toHaveBeenCalledWith(sampleAddresses[1].id),
    )
    expect(mockToast).toHaveBeenCalledWith('Address deleted.', 'success')
  })

  it('cancelling the delete confirmation never calls the action', () => {
    render(<CustomerAddresses customerId={CUSTOMER_ID} addresses={sampleAddresses} />)

    fireEvent.click(screen.getByRole('button', { name: /delete address: 789 commerce/i }))
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.queryByText(/delete this address\?/i)).not.toBeInTheDocument()
    expect(mockDeleteCustomerAddress).not.toHaveBeenCalled()
  })

  it('surfaces the generic failure message when the action rejects (transport error)', async () => {
    mockDeleteCustomerAddress.mockRejectedValueOnce(new Error('network down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<CustomerAddresses customerId={CUSTOMER_ID} addresses={sampleAddresses} />)

    fireEvent.click(screen.getByRole('button', { name: /delete address: 789 commerce/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, delete/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
