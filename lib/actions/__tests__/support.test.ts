import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockStorageUpload = vi.hoisted(() => vi.fn())
const mockStorageRemove = vi.hoisted(() => vi.fn())
const mockStorageSignUrl = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    storage: {
      from: () => ({
        upload: mockStorageUpload,
        remove: mockStorageRemove,
        createSignedUrl: mockStorageSignUrl,
      }),
    },
  }),
}))

vi.mock('@/db', () => ({
  db: { insert: mockInsert, select: mockSelect, transaction: mockTransaction },
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

import {
  createTicket,
  getSupportAttachmentSignedUrl,
  uploadTicketAttachment,
} from '../support'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const AUTH_FAIL = { data: { user: null }, error: new Error('no session') }

const TICKET_ID = '44444444-4444-4444-4444-444444444444'

function stubInsertReturning(id: string) {
  mockInsert.mockReturnValueOnce({
    values: () => ({ returning: () => Promise.resolve([{ id }]) }),
  })
}

function stubSelectCount(n: number) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => Promise.resolve([{ n }]),
    }),
  })
}

// Stubs `db.transaction` so the callback runs against a fake `tx` with
// `execute` (advisory lock), `select` (authoritative count), and `insert`
// (row write). `countInTx` feeds the in-tx count query; `insertThrows`,
// when set, makes the tx insert reject — used to prove LOW-01 orphan
// cleanup runs on post-upload DB failure.
function stubTransaction(config: { countInTx: number; insertThrows?: unknown }) {
  mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      execute: () => Promise.resolve(undefined),
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ n: config.countInTx }]),
        }),
      }),
      insert: () => ({
        values: () => {
          if (config.insertThrows !== undefined) return Promise.reject(config.insertThrows)
          return Promise.resolve(undefined)
        },
      }),
    }
    return await fn(tx)
  })
}

function makePng(name = 'screenshot.png', sizeBytes = 1024): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'image/png' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTicket', () => {
  const VALID_INPUT = {
    title: 'Cannot save a new lead',
    category: 'bug' as const,
    priority: 'high' as const,
    description: 'Clicking Save Lead throws a 500 from the server.',
  }

  it('inserts the ticket with status=open and returns the new id on success', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubInsertReturning('ticket-1')
    const result = await createTicket(VALID_INPUT)
    expect(result).toEqual({ id: 'ticket-1' })
    expect(mockInsert).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/support')
  })

  it('rejects an empty title before the DB is touched', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await createTicket({ ...VALID_INPUT, title: '   ' })
    expect(result).toEqual({ error: 'Title is required.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects an empty description before the DB is touched', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await createTicket({ ...VALID_INPUT, description: '' })
    expect(result).toEqual({ error: 'Description is required.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects an unknown category', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await createTicket({
      ...VALID_INPUT,
      category: 'compliments' as unknown as typeof VALID_INPUT.category,
    })
    expect(result).toHaveProperty('error')
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns an auth error when the user is not signed in', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_FAIL)
    const result = await createTicket(VALID_INPUT)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns a generic error when the insert rejects', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    mockInsert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.reject(new Error('db down')) }),
    })
    const result = await createTicket(VALID_INPUT)
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/db down/i)
  })
})

describe('uploadTicketAttachment', () => {
  it('uploads the file, inserts via tx, and returns the storage path', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectCount(0)
    mockStorageUpload.mockResolvedValueOnce({ error: null })
    stubTransaction({ countInTx: 0 })

    const result = await uploadTicketAttachment(TICKET_ID, makePng())

    expect(result).toHaveProperty('path')
    const path = (result as { path: string }).path
    expect(path.startsWith(`${TICKET_ID}/`)).toBe(true)
    expect(path.endsWith('_screenshot.png')).toBe(true)
    expect(mockStorageUpload).toHaveBeenCalledOnce()
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockStorageRemove).not.toHaveBeenCalled()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/support')
  })

  it('rejects a malformed ticket id before validating the file', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await uploadTicketAttachment('not-a-uuid', makePng())
    expect(result).toEqual({ error: 'Invalid ticket id.' })
    expect(mockStorageUpload).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects a file over 5MB without touching storage or the DB', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const bigFile = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf', {
      type: 'application/pdf',
    })
    const result = await uploadTicketAttachment(TICKET_ID, bigFile)
    expect(result).toEqual({ error: 'File too large. Maximum 5MB per file.' })
    expect(mockStorageUpload).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects a disallowed MIME type', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const txtFile = new File(['hello'], 'note.txt', { type: 'text/plain' })
    const result = await uploadTicketAttachment(TICKET_ID, txtFile)
    expect(result).toEqual({ error: 'Only PNG, JPG, and PDF files are accepted.' })
    expect(mockStorageUpload).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('fast-fails via the pre-upload count check when the ticket already has 3 attachments', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectCount(3)
    const result = await uploadTicketAttachment(TICKET_ID, makePng())
    expect(result).toEqual({ error: 'Maximum 3 attachments per ticket.' })
    expect(mockStorageUpload).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockStorageRemove).not.toHaveBeenCalled()
  })

  it('returns a generic error when the storage upload fails', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectCount(0)
    mockStorageUpload.mockResolvedValueOnce({ error: new Error('storage outage') })
    const result = await uploadTicketAttachment(TICKET_ID, makePng())
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/storage outage/i)
    // Upload failed before any DB state change — no orphan to clean up.
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockStorageRemove).not.toHaveBeenCalled()
  })

  it('returns an auth error when the user is not signed in', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_FAIL)
    const result = await uploadTicketAttachment(TICKET_ID, makePng())
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockStorageUpload).not.toHaveBeenCalled()
  })

  it('sanitises path traversal in filenames', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectCount(0)
    mockStorageUpload.mockResolvedValueOnce({ error: null })
    stubTransaction({ countInTx: 0 })

    const evilFile = new File([new Uint8Array(100)], '../../evil.png', { type: 'image/png' })
    const result = await uploadTicketAttachment(TICKET_ID, evilFile)

    const path = (result as { path: string }).path
    expect(path).not.toMatch(/\.\./)
    expect(path.startsWith(`${TICKET_ID}/`)).toBe(true)
    const tail = path.slice(`${TICKET_ID}/`.length)
    expect(tail.includes('/')).toBe(false)
  })

  // LOW-01 — orphan cleanup on post-upload DB failure.
  it('removes the orphaned upload and returns a generic error when the tx insert throws', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectCount(0)
    mockStorageUpload.mockResolvedValueOnce({ error: null })
    stubTransaction({ countInTx: 0, insertThrows: new Error('db down') })
    mockStorageRemove.mockResolvedValueOnce({ error: null })

    const result = await uploadTicketAttachment(TICKET_ID, makePng())

    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/db down/i)
    expect(mockStorageRemove).toHaveBeenCalledOnce()
    // Remove is called with the exact storage path that was uploaded.
    const [removedPaths] = mockStorageRemove.mock.calls[0]
    expect(Array.isArray(removedPaths)).toBe(true)
    expect(removedPaths[0].startsWith(`${TICKET_ID}/`)).toBe(true)
  })

  // LOW-02 — authoritative in-tx count check rejects when a concurrent
  // upload has committed since the pre-upload fast-fail count was read.
  it('rejects over-quota inside the tx and removes the orphaned upload', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectCount(2) // pre-upload: two attachments already — under cap
    mockStorageUpload.mockResolvedValueOnce({ error: null })
    // Inside the tx the count is now 3 (concurrent tx committed first).
    stubTransaction({ countInTx: 3 })
    mockStorageRemove.mockResolvedValueOnce({ error: null })

    const result = await uploadTicketAttachment(TICKET_ID, makePng())

    expect(result).toEqual({ error: 'Maximum 3 attachments per ticket.' })
    expect(mockStorageRemove).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  // LOW-03 — NUL and other C0 control chars are stripped before the
  // sanitised name is used in the storage path or the DB row.
  it('strips null bytes and control characters from the filename before storing', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubSelectCount(0)
    mockStorageUpload.mockResolvedValueOnce({ error: null })
    stubTransaction({ countInTx: 0 })

    const sneakyFile = new File([new Uint8Array(100)], 'evil .exe.png', {
      type: 'image/png',
    })
    const result = await uploadTicketAttachment(TICKET_ID, sneakyFile)

    const path = (result as { path: string }).path
    expect(path).not.toMatch(/ /)
    expect(path.endsWith('_evil.exe.png')).toBe(true)
  })
})

// Stubs the `db.select(...).from(...).where(...).limit(1)` chain used by
// `getSupportAttachmentSignedUrl` to look the row up by attachment id.
// Pass `null` to simulate a missing row.
function stubAttachmentLookup(row: { file_url: string } | null) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(row ? [row] : []),
      }),
    }),
  })
}

describe('getSupportAttachmentSignedUrl', () => {
  const ATTACHMENT_ID = '55555555-5555-5555-5555-555555555555'
  const STORAGE_PATH = `${TICKET_ID}/abc_screenshot.png`
  const SIGNED_URL = 'https://example.supabase.co/storage/v1/object/sign/support-attachments/abc?token=xyz'

  it('returns a fresh signed URL when the attachment row exists and the bucket accepts the sign request', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubAttachmentLookup({ file_url: STORAGE_PATH })
    mockStorageSignUrl.mockResolvedValueOnce({ data: { signedUrl: SIGNED_URL }, error: null })

    const result = await getSupportAttachmentSignedUrl(ATTACHMENT_ID)

    expect(result).toEqual({ url: SIGNED_URL })
    expect(mockStorageSignUrl).toHaveBeenCalledWith(STORAGE_PATH, 60 * 60)
  })

  it('rejects an unauthenticated caller before touching the DB or storage', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_FAIL)
    const result = await getSupportAttachmentSignedUrl(ATTACHMENT_ID)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockStorageSignUrl).not.toHaveBeenCalled()
  })

  it('rejects a malformed attachment id before touching the DB', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const result = await getSupportAttachmentSignedUrl('not-a-uuid')
    expect(result).toEqual({ error: 'Invalid attachment id.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockStorageSignUrl).not.toHaveBeenCalled()
  })

  it('rejects with "Attachment not found." when no matching row exists', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubAttachmentLookup(null)

    const result = await getSupportAttachmentSignedUrl(ATTACHMENT_ID)

    expect(result).toEqual({ error: 'Attachment not found.' })
    expect(mockStorageSignUrl).not.toHaveBeenCalled()
  })

  it('returns a generic error when the DB lookup throws', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    mockSelect.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.reject(new Error('db down')),
        }),
      }),
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await getSupportAttachmentSignedUrl(ATTACHMENT_ID)

    consoleSpy.mockRestore()
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/db down/i)
    expect(mockStorageSignUrl).not.toHaveBeenCalled()
  })

  it('returns a generic error when the signed-URL API returns an error', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubAttachmentLookup({ file_url: STORAGE_PATH })
    mockStorageSignUrl.mockResolvedValueOnce({ data: null, error: new Error('storage outage') })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await getSupportAttachmentSignedUrl(ATTACHMENT_ID)

    consoleSpy.mockRestore()
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).not.toMatch(/storage outage/i)
  })
})
