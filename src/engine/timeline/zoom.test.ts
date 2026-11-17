import { describe, expect, it } from 'vitest'
import {
  MIN_SPAN_MS,
  centerView,
  clampView,
  fullView,
  panView,
  revealView,
  tickStep,
  viewPct,
  zoomLevel,
  zoomView,
} from './zoom'

const total = 60000

describe('timeline zoom', () => {
  it('starts on the whole take and clamps to it', () => {
    expect(fullView(total)).toEqual({ start: 0, span: total })
    expect(clampView({ start: -5, span: 999999 }, total)).toEqual({
      start: 0,
      span: total,
    })
    expect(clampView({ start: 59000, span: 10000 }, total)).toEqual({
      start: 50000,
      span: 10000,
    })
    expect(clampView({ start: 0, span: 10 }, total).span).toBe(MIN_SPAN_MS)
  })

  it('zooms around the anchor so it stays at the same screen position', () => {
    const v = fullView(total)
    const z = zoomView(v, total, 4, 30000)
    expect(z.span).toBe(15000)
    expect(viewPct(z, 30000)).toBeCloseTo(viewPct(v, 30000), 5)
    expect(zoomLevel(z, total)).toBe(4)
    // Anchored near an edge it clamps instead of showing outside the take.
    const edge = zoomView(v, total, 4, 0)
    expect(edge.start).toBe(0)
    const end = zoomView(v, total, 4, total)
    expect(end.start + end.span).toBe(total)
  })

  it('zooms out to no further than the whole take', () => {
    const z = zoomView({ start: 10000, span: 20000 }, total, 0.1, 20000)
    expect(z).toEqual({ start: 0, span: total })
  })

  it('pans and centres within the take', () => {
    const v = { start: 10000, span: 10000 }
    expect(panView(v, total, 5000).start).toBe(15000)
    expect(panView(v, total, -50000).start).toBe(0)
    expect(centerView(v, total, 30000).start).toBe(25000)
    expect(centerView(v, total, 0).start).toBe(0)
  })

  it('scrolls to reveal a moment only when it is off screen', () => {
    const v = { start: 10000, span: 10000 }
    expect(revealView(v, total, 15000)).toBe(v)
    const r = revealView(v, total, 30000)
    expect(r.start).toBe(28000)
    expect(r.span).toBe(10000)
  })

  it('chooses readable ruler steps', () => {
    expect(tickStep(60000)).toBe(10000)
    expect(tickStep(4000)).toBe(500)
    expect(tickStep(1000)).toBe(100)
    expect(tickStep(7200000)).toBe(1800000)
  })
})
