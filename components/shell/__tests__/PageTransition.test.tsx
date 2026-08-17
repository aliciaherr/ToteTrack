import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PageTransition from '../PageTransition'

const reducedMotionMock = vi.hoisted(() => ({ value: false }))

// The motion-only props are named so they are stripped from `rest` and never
// reach a real DOM node. A `type` is erased, so the hoisted factory can use it.
type MotionMockProps = Record<string, unknown> & { children?: React.ReactNode }

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, variants, initial, animate, ...rest }: MotionMockProps) => (
      <div
        data-testid="page-transition"
        data-variants={variants ? 'present' : 'none'}
        data-initial={initial as string | undefined}
        data-animate={animate as string | undefined}
        {...rest}
      >
        {children}
      </div>
    ),
  },
  useReducedMotion: () => reducedMotionMock.value,
}))

describe('PageTransition', () => {
  it('renders children without error', () => {
    reducedMotionMock.value = false
    render(
      <PageTransition>
        <span>inner content</span>
      </PageTransition>,
    )
    expect(screen.getByText('inner content')).toBeInTheDocument()
  })

  it('passes variants to motion.div when reduced motion is off', () => {
    reducedMotionMock.value = false
    render(
      <PageTransition>
        <span>x</span>
      </PageTransition>,
    )
    expect(screen.getByTestId('page-transition').dataset.variants).toBe('present')
  })

  it('applies instant variants (undefined) when useReducedMotion is true', () => {
    reducedMotionMock.value = true
    render(
      <PageTransition>
        <span>x</span>
      </PageTransition>,
    )
    expect(screen.getByTestId('page-transition').dataset.variants).toBe('none')
  })
})
