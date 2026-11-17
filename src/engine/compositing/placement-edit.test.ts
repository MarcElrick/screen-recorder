import { describe, expect, it } from 'vitest'
import {
  clampPlacement,
  movePlacement,
  nearestCorner,
  placementForCorner,
  resizeFromCorner,
  withShape,
  withWidth,
} from './placement'

const A = 16 / 9
const pixelAspect = (p: { width: number; height: number }) =>
  (p.width / p.height) * A

describe('placement editing', () => {
  const p = { x: 0.7, y: 0.6, width: 0.2, height: (0.2 * A) / 1 }

  it('clamps moves inside the canvas', () => {
    const m = movePlacement(p, 5, 5)
    expect(m.x + m.width).toBeCloseTo(1)
    expect(m.y + m.height).toBeCloseTo(1)
    expect(movePlacement(p, -5, -5)).toMatchObject({ x: 0, y: 0 })
    expect(clampPlacement({ x: -1, y: 2, width: 2, height: 0 }).width).toBe(1)
  })

  it('snaps to corner presets keeping size', () => {
    const tl = placementForCorner(p, 'top-left')
    expect(tl.x).toBeLessThan(0.05)
    expect(tl.y).toBeLessThan(0.1)
    expect(tl.width).toBe(p.width)
    expect(nearestCorner(tl)).toBe('top-left')
    expect(nearestCorner(placementForCorner(p, 'bottom-right'))).toBe(
      'bottom-right',
    )
  })

  it('switches shape to square (circle) or 4:3 (rounded) pixels', () => {
    const circle = withShape(p, 'circle')
    expect(pixelAspect(circle)).toBeCloseTo(1)
    const rounded = withShape(p, 'rounded')
    expect(pixelAspect(rounded)).toBeCloseTo(4 / 3)
    expect(rounded.width).toBe(p.width)
  })

  it('resizes by width preserving aspect', () => {
    const r = withWidth(p, 0.3)
    expect(r.width).toBeCloseTo(0.3)
    expect(pixelAspect(r)).toBeCloseTo(pixelAspect(p))
    expect(withWidth(p, 5).width).toBeLessThanOrEqual(0.6)
  })

  it('resizes from a corner handle with the opposite corner fixed', () => {
    const start = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 * A }
    const r = resizeFromCorner(start, 'bottom-right', { x: 0.7, y: 0.9 })
    expect(r.x).toBeCloseTo(0.4)
    expect(r.y).toBeCloseTo(0.4)
    expect(r.width).toBeCloseTo(0.3)
    expect(pixelAspect(r)).toBeCloseTo(pixelAspect(start))
    const tl = resizeFromCorner(start, 'top-left', { x: 0.3, y: 0.3 })
    expect(tl.x + tl.width).toBeCloseTo(0.6)
    expect(tl.y + tl.height).toBeCloseTo(0.4 + start.height)
    // never leaves the canvas
    const big = resizeFromCorner(start, 'bottom-right', { x: 2, y: 2 })
    expect(big.x + big.width).toBeLessThanOrEqual(1.0000001)
    expect(big.y + big.height).toBeLessThanOrEqual(1.0000001)
  })
})
