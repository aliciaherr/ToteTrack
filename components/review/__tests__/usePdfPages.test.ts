import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MAX_PDF_PAGES } from '@/lib/extraction/extraction.constants'
import { usePdfPages, pageScale, PDF_VIEW_SCALE, MAX_PDF_VIEW_PIXELS } from '../usePdfPages'
import { openPdf } from '../pdfjsClient'

vi.mock('../pdfjsClient', () => ({ openPdf: vi.fn() }))

const URL = 'https://example.supabase.co/storage/v1/object/sign/po-documents/a.pdf?token=t'
const LETTER = { width: 612, height: 792 }

function fakePage(render = vi.fn(() => ({ promise: Promise.resolve() }))) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: LETTER.width * scale, height: LETTER.height * scale }),
    render,
    cleanup: vi.fn(),
  }
}

function fakeOpened(numPages: number, page = fakePage()) {
  const close = vi.fn(() => Promise.resolve())
  const document = { numPages, getPage: vi.fn(() => Promise.resolve(page)) }
  vi.mocked(openPdf).mockResolvedValue({ document, close } as never)
  return { close, document, page }
}

beforeEach(() => {
  vi.mocked(openPdf).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('usePdfPages', () => {
  it('draws every page of a short PDF, one canvas each', async () => {
    const { document } = fakeOpened(3)
    const { result } = renderHook(() => usePdfPages(URL))
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.canvases).toHaveLength(3)
    expect(result.current.totalPages).toBe(3)
    expect(result.current.canvases[0].width).toBe(Math.floor(LETTER.width * PDF_VIEW_SCALE))
    expect(document.getPage).toHaveBeenCalledTimes(3)
  })

  it(`draws only the first ${MAX_PDF_PAGES} pages of a longer PDF and reports the real count`, async () => {
    const { document } = fakeOpened(9)
    const { result } = renderHook(() => usePdfPages(URL))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.canvases).toHaveLength(MAX_PDF_PAGES)
    expect(result.current.totalPages).toBe(9)
    expect(document.getPage).toHaveBeenCalledTimes(MAX_PDF_PAGES)
  })

  it('goes to the error state when the PDF will not open, and logs it without the URL', async () => {
    vi.mocked(openPdf).mockRejectedValue(new Error('Invalid PDF structure'))
    const { result } = renderHook(() => usePdfPages(URL))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(console.error).toHaveBeenCalledWith('usePdfPages: could not display the PDF', expect.anything())
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('token=t')
  })

  it('goes to the error state when a page fails to draw', async () => {
    fakeOpened(2, fakePage(vi.fn(() => ({ promise: Promise.reject(new Error('bad operator')) }))))
    const { result } = renderHook(() => usePdfPages(URL))
    await waitFor(() => expect(result.current.status).toBe('error'))
  })

  it('destroys the document on unmount', async () => {
    const { close } = fakeOpened(1)
    const { result, unmount } = renderHook(() => usePdfPages(URL))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    unmount()
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it('destroys a document that finishes opening after unmount', async () => {
    let finishOpen: (value: unknown) => void = () => undefined
    const close = vi.fn(() => Promise.resolve())
    vi.mocked(openPdf).mockReturnValue(new Promise((resolve) => (finishOpen = resolve)) as never)
    const { unmount } = renderHook(() => usePdfPages(URL))
    unmount()
    finishOpen({ document: { numPages: 1, getPage: vi.fn(() => Promise.resolve(fakePage())) }, close })
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
  })
})

describe('pageScale', () => {
  it('scales by PDF_VIEW_SCALE times the device pixel ratio', () => {
    expect(pageScale(LETTER.width, LETTER.height, 2)).toBe(PDF_VIEW_SCALE * 2)
  })

  it('shrinks an oversized page to MAX_PDF_VIEW_PIXELS', () => {
    const scale = pageScale(14_400, 14_400, 2)
    expect(14_400 * 14_400 * scale * scale).toBeCloseTo(MAX_PDF_VIEW_PIXELS, -2)
  })
})
