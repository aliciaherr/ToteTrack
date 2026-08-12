'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'

/**
 * Segment-level error boundary for every authenticated route. Next renders this
 * in place of the crashed page while keeping `(app)/layout.tsx` mounted, so the
 * operator keeps `AppShell`'s sidebar and can navigate away — the failure mode
 * this replaces was a blank document with no route back.
 *
 * The error's own text is deliberately never rendered. A thrown DB or Supabase
 * error can carry a connection string or a row of customer data in its message,
 * and this screen is the one place in the app that would put raw internals on a
 * page. Diagnostics go to the console instead, where only the operator's own
 * devtools can reach them.
 *
 * `digest` is the hash Next assigns to a server-side error; in production it is
 * the *only* handle on the original stack, which is why it is logged even
 * though it is never shown.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[AppError] Unhandled error in an authenticated route.', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    })
  }, [error])

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-md w-full rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-base font-semibold text-foreground">
          Something went wrong.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page hit an unexpected error. Nothing you were viewing has been
          changed. Try again — if it keeps happening, the details are in the
          browser console.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
