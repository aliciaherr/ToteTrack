'use client'

import { useEffect } from 'react'
import './globals.css'

/**
 * Last-resort boundary for a throw inside the root layout itself. Next replaces
 * the entire document when this fires, which is why it renders its own `<html>`
 * and `<body>` — and why it imports no app chrome. `AppShell` and
 * `ToastProvider` live inside the layout that just failed; reaching for them
 * here would re-run the code that crashed.
 *
 * Recovery is a full reload rather than `reset()`'s re-render: when the root
 * layout is the thing that broke, re-rendering it lands on the same error.
 * `reset` is still accepted because Next always passes it.
 *
 * Same rule as `(app)/error.tsx` — the error's own text never reaches the DOM.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalError] Unhandled error in the root layout.', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    })
  }, [error])

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="min-h-screen flex items-center justify-center bg-app-bg p-8">
          <div className="max-w-md w-full rounded-lg border border-border bg-card p-8 text-center">
            <h1 className="text-base font-semibold text-foreground">
              ToteTrack could not load.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The app hit an error before it finished starting. Reload the page —
              if it keeps happening, the details are in the browser console.
            </p>
            <a
              href="/dashboard"
              className="mt-6 inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground"
            >
              Reload ToteTrack
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
