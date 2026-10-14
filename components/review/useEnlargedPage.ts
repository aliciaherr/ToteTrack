'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** State and handlers returned by `useEnlargedPage`. */
export interface EnlargedPage {
  /** An object URL for the enlarged page's PNG, or null when none is open. */
  url: string | null
  /** True when the last page tapped could not be turned into an image. */
  failed: boolean
  /** Encodes `canvas` off the main thread and opens it. */
  enlarge: (canvas: HTMLCanvasElement) => void
  /** Closes the enlarged page; its object URL is revoked. */
  close: () => void
}

/**
 * One drawn PDF page, enlarged (Task 117). The canvas is encoded with the
 * asynchronous `toBlob`, never `toDataURL`, which would block the iPad's main
 * thread on a page of several million pixels and hold the whole PNG as a
 * string. The object URL is revoked when the page closes, another opens, or
 * the view unmounts. A page that cannot be encoded is logged and reported
 * (EH-01), never a silent no-op tap.
 */
export function useEnlargedPage(): EnlargedPage {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  const fail = useCallback((cause: unknown) => {
    console.error('useEnlargedPage: could not turn the PDF page into an image', { cause })
    setFailed(true)
  }, [])

  const enlarge = useCallback(
    (canvas: HTMLCanvasElement) => {
      setFailed(false)
      try {
        canvas.toBlob((blob) => {
          if (!isMountedRef.current) return
          if (!blob) return fail(new Error('canvas.toBlob returned null'))
          setUrl(URL.createObjectURL(blob))
        }, 'image/png')
      } catch (cause) {
        fail(cause)
      }
    },
    [fail],
  )

  const close = useCallback(() => setUrl(null), [])

  return { url, failed, enlarge, close }
}
