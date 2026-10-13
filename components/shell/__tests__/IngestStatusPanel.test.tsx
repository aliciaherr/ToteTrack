import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import IngestStatusPanel from '../IngestStatusPanel'
import type { IngestStatus } from '@/lib/actions/ingest'

// Local-time constructors, so "Today" holds in any time zone.
const NOW = new Date(2026, 9, 12, 14, 30)
const TODAY_RUN = new Date(2026, 9, 12, 6, 12).toISOString()

function statusOf(overrides: Partial<IngestStatus> = {}): IngestStatus {
  return { toReview: 3, beingRead: 2, lastRunAt: TODAY_RUN, failingCount: 0, ...overrides }
}

function renderPanel(props: Partial<Parameters<typeof IngestStatusPanel>[0]> = {}) {
  const handlers = { onRetry: vi.fn(), onCheckMail: vi.fn(), onReview: vi.fn() }
  render(
    <IngestStatusPanel status={statusOf()} hasLoadError={false} isChecking={false} now={NOW} {...handlers} {...props} />,
  )
  return handlers
}

describe('IngestStatusPanel', () => {
  it('shows the undecided total and its split', () => {
    renderPanel()

    expect(screen.getByText('5 pending')).toBeInTheDocument()
    expect(screen.getByText('3 to review · 2 being read')).toBeInTheDocument()
  })

  it('says "Nothing pending" when every PO has been decided', () => {
    renderPanel({ status: statusOf({ toReview: 0, beingRead: 0 }) })

    expect(screen.getByText('Nothing pending')).toBeInTheDocument()
  })

  it('shows a recent last check plainly', () => {
    renderPanel()

    const line = screen.getByText('Last checked Today 6:12 AM')
    expect(line).toHaveAttribute('data-stale', 'false')
  })

  it('shows an old or missing last check in amber', () => {
    renderPanel({ status: statusOf({ lastRunAt: new Date(2026, 9, 9, 6, 0).toISOString() }) })
    expect(screen.getByText('Last checked Oct 9, 6:00 AM')).toHaveAttribute('data-stale', 'true')
  })

  it('says "Never checked" in amber before the first run', () => {
    renderPanel({ status: statusOf({ lastRunAt: null }) })

    expect(screen.getByText('Never checked')).toHaveAttribute('data-stale', 'true')
  })

  it('alerts on emails that keep failing to import, and stays quiet with none', () => {
    renderPanel({ status: statusOf({ failingCount: 2 }) })
    expect(screen.getByRole('alert')).toHaveTextContent("2 emails can't be imported.")
  })

  it('shows no failing alert when nothing is failing', () => {
    renderPanel()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('starts a mail check on tap', () => {
    const { onCheckMail } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /check mail now/i }))

    expect(onCheckMail).toHaveBeenCalledOnce()
  })

  it('disables the button and shows progress while a check runs', () => {
    renderPanel({ isChecking: true })

    expect(screen.getByRole('button', { name: /checking mail/i })).toBeDisabled()
  })

  it('offers a retry instead of numbers when the status could not load', () => {
    const { onRetry } = renderPanel({ hasLoadError: true })

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the review queue.")
    expect(screen.queryByText('5 pending')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('opens the review overlay on "Review"', () => {
    const { onReview } = renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(onReview).toHaveBeenCalledOnce()
  })

  it('disables "Review" when nothing is to review, even with POs being read', () => {
    renderPanel({ status: statusOf({ toReview: 0, beingRead: 2 }) })

    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled()
  })

  it('disables "Review" while the status is loading or failed', () => {
    renderPanel({ status: null })
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled()
  })
})
