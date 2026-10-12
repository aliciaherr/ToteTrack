import { describe, expect, it } from 'vitest'
import { containsWithinOneEdit } from '../fuzzy'

describe('containsWithinOneEdit', () => {
  it('finds an exact substring', () => {
    expect(containsWithinOneEdit('viton', 'ballvalve,qd,viton31ha1')).toBe(true)
  })

  it('counts a swap of two neighbouring letters as one edit', () => {
    expect(containsWithinOneEdit('vtion', 'ballvalve,qd,viton31ha1')).toBe(true)
  })

  it('accepts one substitution, insertion or deletion', () => {
    expect(containsWithinOneEdit('shipton', 'xxshiptanxx')).toBe(true)
    expect(containsWithinOneEdit('shipton', 'xxshipptonxx')).toBe(true)
    expect(containsWithinOneEdit('shipton', 'xxshiptnxx')).toBe(true)
  })

  it('rejects two edits', () => {
    expect(containsWithinOneEdit('shipton', 'xxshaptanxx')).toBe(false)
  })

  it('rejects text with nothing close', () => {
    expect(containsWithinOneEdit('shipton', 'completely different')).toBe(false)
    expect(containsWithinOneEdit('shipton', '')).toBe(false)
  })
})
