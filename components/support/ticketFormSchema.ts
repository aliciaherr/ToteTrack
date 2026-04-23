import type { SupportCategory, SupportPriority } from '@/lib/actions/support.constants'

export interface TicketFormValues {
  title: string
  category: SupportCategory
  priority: SupportPriority
  description: string
}

export const EMPTY_TICKET_FORM_VALUES: TicketFormValues = {
  title: '',
  category: 'bug',
  priority: 'standard',
  description: '',
}
