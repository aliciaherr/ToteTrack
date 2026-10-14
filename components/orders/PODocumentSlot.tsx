'use client'

import { ExternalLink, Loader2, RotateCw } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OrderDetail as OrderDetailType } from '@/db/queries/orders'
import { useOrderDocumentUrl } from './useOrderDocumentUrl'

const NO_DOCUMENT_TEXT = 'No document on file. In-app upload is not available in v1.'
const EMAIL_BODY_TEXT = 'Created from an email: no file'

/**
 * The signed link to the order's stored PO document (Task 121). Only the URL
 * the server signs is ever linked; `document_url` itself (a storage path) never is.
 */
function DocumentLink({ orderId }: { orderId: string }) {
  const { state, retry } = useOrderDocumentUrl(orderId)

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 min-h-[44px] text-sm text-secondary">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading the PO document…
      </p>
    )
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="space-y-3">
        <p className="text-sm text-destructive">{state.message}</p>
        <Button type="button" variant="outline" onClick={retry} className="min-h-[44px]">
          <RotateCw aria-hidden="true" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <a
      href={state.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: 'outline' }), 'min-h-[44px]')}
    >
      <ExternalLink aria-hidden="true" />
      View PO document
    </a>
  )
}

export function PODocumentSlot({ detail }: { detail: OrderDetailType }) {
  const hasDocument = Boolean(detail.document_url)
  return (
    <section
      aria-label="PO document"
      className="rounded-lg border border-border bg-card p-4 space-y-2"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        PO Document
      </div>
      {hasDocument ? (
        // Keyed so switching orders starts a fresh signing request for the new one.
        <DocumentLink key={detail.id} orderId={detail.id} />
      ) : (
        <p className="text-sm text-foreground">
          {detail.source_kind === 'email_body' ? EMAIL_BODY_TEXT : NO_DOCUMENT_TEXT}
        </p>
      )}
    </section>
  )
}
