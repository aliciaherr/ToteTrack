import { describe, it, expect } from 'vitest'
import { buildListItemMotionProps, LIST_STAGGER_CAP_INDEX, LIST_STAGGER_STEP_SECONDS } from '../list-animation'

describe('buildListItemMotionProps', () => {
  it('returns an empty object when reduced motion is on', () => {
    expect(buildListItemMotionProps(0, true)).toEqual({})
  })

  it('returns variants + initial + animate + transition when reduced motion is off', () => {
    const props = buildListItemMotionProps(0, false)
    expect(props.variants).toBeDefined()
    expect(props.initial).toBe('hidden')
    expect(props.animate).toBe('visible')
    expect(props.transition).toBeDefined()
  })

  it('scales delay by index until the cap', () => {
    expect(buildListItemMotionProps(0, false).transition?.delay).toBeCloseTo(0)
    expect(buildListItemMotionProps(3, false).transition?.delay).toBeCloseTo(
      3 * LIST_STAGGER_STEP_SECONDS,
    )
    expect(buildListItemMotionProps(LIST_STAGGER_CAP_INDEX, false).transition?.delay).toBeCloseTo(
      LIST_STAGGER_CAP_INDEX * LIST_STAGGER_STEP_SECONDS,
    )
  })

  it('clamps delay at the cap for indexes beyond the cap', () => {
    const cappedDelay = LIST_STAGGER_CAP_INDEX * LIST_STAGGER_STEP_SECONDS
    expect(buildListItemMotionProps(LIST_STAGGER_CAP_INDEX + 1, false).transition?.delay).toBeCloseTo(cappedDelay)
    expect(buildListItemMotionProps(50, false).transition?.delay).toBeCloseTo(cappedDelay)
  })
})
