import { describe, it, expect } from 'vitest'
import {
  pageVariants,
  modalVariants,
  cancelVariants,
  staggerContainer,
  staggerItem,
  collapsibleVariants,
} from '../animations'

describe('lib/animations', () => {
  it('all 6 exports are plain objects', () => {
    const exports = {
      pageVariants,
      modalVariants,
      cancelVariants,
      staggerContainer,
      staggerItem,
      collapsibleVariants,
    }

    for (const [name, value] of Object.entries(exports)) {
      expect(typeof value, `${name} should be an object`).toBe('object')
      expect(value, `${name} should not be null`).not.toBeNull()
      expect(Array.isArray(value), `${name} should not be an array`).toBe(false)
    }
  })

  it('pageVariants: hidden state starts at y=4, visible state lands at y=0', () => {
    expect(pageVariants.hidden.y).toBe(4)
    expect(pageVariants.visible.y).toBe(0)
  })

  it('modalVariants: panel scales from 0.97 to 1', () => {
    expect(modalVariants.panel.hidden.scale).toBe(0.97)
    expect(modalVariants.panel.visible.scale).toBe(1)
  })

  it('staggerContainer: staggers children at 30ms', () => {
    expect(staggerContainer.visible.transition.staggerChildren).toBe(0.03)
  })

  it('collapsibleVariants: expanded uses auto height', () => {
    expect(collapsibleVariants.expanded.height).toBe('auto')
    expect(collapsibleVariants.collapsed.height).toBe(0)
  })
})
