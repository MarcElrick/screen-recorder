import { describe, expect, it } from 'vitest'
import { bubblePlacement } from './placement'

describe('bubblePlacement', () => {
  it('keeps a square bubble square in pixel terms and inside the frame', () => {
    for (const corner of [
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ] as const) {
      const p = bubblePlacement({ corner, size: 0.2 }, 1, 16 / 9)
      expect((p.height * 9) / (p.width * 16)).toBeCloseTo(1)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + p.width).toBeLessThanOrEqual(1)
      expect(p.y + p.height).toBeLessThanOrEqual(1)
    }
  })

  it('places corners on the right sides', () => {
    const tl = bubblePlacement({ corner: 'top-left', size: 0.2 })
    const br = bubblePlacement({ corner: 'bottom-right', size: 0.2 })
    expect(tl.x).toBeLessThan(br.x)
    expect(tl.y).toBeLessThan(br.y)
  })
})
