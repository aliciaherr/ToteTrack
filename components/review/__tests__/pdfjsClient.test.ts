import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getDocument, PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { openPdf } from '../pdfjsClient'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: vi.fn(),
  PDFWorker: vi.fn(function (this: { destroy: () => void }) {
    this.destroy = vi.fn()
  }),
}))

const URL = 'https://example.supabase.co/storage/v1/object/sign/po-documents/a.pdf?token=t'
const terminate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'Worker',
    vi.fn(function (this: { terminate: () => void }) {
      this.terminate = terminate
    }),
  )
})

function fakeTask(promise: Promise<unknown>) {
  const task = { promise, destroy: vi.fn(() => Promise.resolve()) }
  vi.mocked(getDocument).mockReturnValue(task as never)
  return task
}

describe('openPdf', () => {
  it('opens the URL on an app-served worker with no remote data URLs', async () => {
    const pdf = { numPages: 1 }
    fakeTask(Promise.resolve(pdf))
    const opened = await openPdf(URL)
    expect(opened.document).toBe(pdf)
    const [workerUrl] = vi.mocked(Worker).mock.calls[0] as unknown as [URL]
    expect(String(workerUrl)).toContain('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
    const params = vi.mocked(getDocument).mock.calls[0][0] as Record<string, unknown>
    expect(params).toMatchObject({ url: URL })
    for (const key of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl', 'iccUrl']) expect(params[key]).toBeUndefined()
  })

  it('close destroys the document and terminates the worker', async () => {
    const task = fakeTask(Promise.resolve({ numPages: 1 }))
    const opened = await openPdf(URL)
    await opened.close()
    expect(task.destroy).toHaveBeenCalledOnce()
    expect(vi.mocked(PDFWorker).mock.instances[0].destroy).toHaveBeenCalledOnce()
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('releases the worker and rethrows when the PDF will not open', async () => {
    const task = fakeTask(Promise.reject(new Error('Invalid PDF structure')))
    await expect(openPdf(URL)).rejects.toThrow('Invalid PDF structure')
    expect(task.destroy).toHaveBeenCalledOnce()
    expect(terminate).toHaveBeenCalledOnce()
  })
})
