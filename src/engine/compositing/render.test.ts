import { describe, expect, it } from 'vitest'
import {
  bubbleGeometry,
  containRect,
  coverCrop,
  renderFrame,
  type Ctx2D,
} from './render'

function fakeCtx() {
  const calls: string[] = []
  const rec =
    (name: string) =>
    (...a: unknown[]) =>
      calls.push(
        `${name}:${a.map((x) => (typeof x === 'number' ? Math.round(x) : '')).join(',')}`,
      )
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: rec('fillRect'),
    drawImage: rec('drawImage'),
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    ellipse: rec('ellipse'),
    roundRect: rec('roundRect'),
    clip: rec('clip'),
    stroke: rec('stroke'),
  } as unknown as Ctx2D
  return { ctx, calls }
}

describe('compositor geometry', () => {
  it('contains a 4:3 source in a 16:9 output with side bars', () => {
    expect(containRect(400, 300, 1600, 900)).toEqual({
      x: 200,
      y: 0,
      w: 1200,
      h: 900,
    })
  })

  it('centre-crops a wide camera to a square bubble', () => {
    expect(coverCrop(1600, 900, 100, 100)).toEqual({
      x: 350,
      y: 0,
      w: 900,
      h: 900,
    })
  })

  it('computes pixel geometry for circle and rounded shapes', () => {
    const placement = { x: 0.5, y: 0.5, width: 0.25, height: 0.4444444 }
    const c = bubbleGeometry({ placement, shape: 'circle' }, 1600, 900)
    expect(c.w).toBeCloseTo(400)
    expect(c.radius).toBeCloseTo(200)
    const r = bubbleGeometry({ placement, shape: 'rounded' }, 1600, 900)
    expect(r.radius).toBeLessThan(c.radius)
  })
})

describe('renderFrame', () => {
  const layout = {
    placement: { x: 0.7, y: 0.6, width: 0.25, height: 0.4444 },
    shape: 'circle' as const,
  }
  const out = { width: 1600, height: 900 }
  const screen = { source: 'screen', width: 1600, height: 900 }
  const cam = { source: 'cam', width: 640, height: 480 }

  it('draws screen then a clipped circular camera', () => {
    const { ctx, calls } = fakeCtx()
    renderFrame(ctx, out, screen, cam, layout)
    expect(calls[0]).toMatch(/^fillRect/)
    expect(calls[1]).toMatch(/^drawImage:,0,0,1600,900/)
    expect(calls.some((c) => c.startsWith('ellipse'))).toBe(true)
    expect(calls.some((c) => c.startsWith('clip'))).toBe(true)
    expect(calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(2)
  })

  it('uses roundRect for the rounded shape and skips a missing camera', () => {
    const a = fakeCtx()
    renderFrame(a.ctx, out, screen, cam, { ...layout, shape: 'rounded' })
    expect(a.calls.some((c) => c.startsWith('roundRect'))).toBe(true)
    const b = fakeCtx()
    renderFrame(b.ctx, out, screen, null, layout)
    expect(b.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(1)
    const audioOnly = fakeCtx()
    renderFrame(
      audioOnly.ctx,
      out,
      screen,
      { source: 'x', width: 0, height: 0 },
      layout,
    )
    expect(
      audioOnly.calls.filter((c) => c.startsWith('drawImage')),
    ).toHaveLength(1)
  })
})
