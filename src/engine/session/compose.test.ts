import { describe, expect, it } from 'vitest'
import {
  outputDuration,
  readCompose,
  withCompose,
  type ComposedManifest,
} from './compose'

const base: ComposedManifest = {
  version: 1,
  id: 'take-1',
  createdAt: '2026-01-01T00:00:00Z',
  durationMs: 4000,
  pauses: [{ from: 1000, to: 1500 }],
  tracks: [],
  bubble: {
    settings: { corner: 'bottom-right', size: 0.2 },
    placement: { x: 0.78, y: 0.6, width: 0.2, height: 0.355 },
  },
}

describe('compose state', () => {
  it('reports duration with pauses removed', () => {
    expect(outputDuration(base)).toBe(3500)
  })

  it('loads old sessions with defaults from the recorded bubble', () => {
    const c = readCompose(base)
    expect(c.bubble.shape).toBe('circle')
    expect(c.bubble.placement).toEqual(base.bubble!.placement)
    expect(c.edit.ranges).toEqual([{ startMs: 0, endMs: 3500 }])
  })

  it('falls back when there is no recorded bubble', () => {
    const c = readCompose({ ...base, bubble: null })
    expect(c.bubble.placement.width).toBeGreaterThan(0)
  })

  it('round-trips and survives malformed data', () => {
    const c = readCompose(base)
    c.bubble = {
      shape: 'rounded',
      placement: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
    }
    const saved = JSON.parse(
      JSON.stringify(withCompose(base, c)),
    ) as ComposedManifest
    expect(readCompose(saved).bubble.shape).toBe('rounded')
    const bad = {
      ...base,
      compose: {
        version: 1,
        edit: 5,
        bubble: { shape: 'x', placement: { x: 'a' } },
      },
    } as unknown as ComposedManifest
    const r = readCompose(bad)
    expect(r.bubble.shape).toBe('circle')
    expect(r.bubble.placement).toEqual(base.bubble!.placement)
    expect(r.edit.ranges).toHaveLength(1)
  })
})
