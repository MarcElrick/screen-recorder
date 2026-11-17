import { describe, expect, it } from 'vitest'
import {
  outputDuration,
  readCompose,
  withCompose,
  type ComposedManifest,
} from './compose'
import { SessionClock } from '../recording/clock'
import { trackExtent } from '../timeline/time'

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
  it('keeps the whole recorded duration when there are pauses', () => {
    // durationMs is already recorded time (pauses left out); don't subtract again.
    expect(outputDuration(base)).toBe(4000)
  })

  it('a take with a pause loses nothing on either side of it', () => {
    let t = 0
    const clock = new SessionClock(() => t)
    clock.start()
    t = 2000 // 2s recorded
    clock.pause()
    t = 2500 // 0.5s paused
    clock.resume()
    t = 5000 // 2.5s more
    const durationMs = clock.elapsed()
    const pauses = clock.finish()
    expect(durationMs).toBe(4500)
    const m = { ...base, durationMs, pauses }
    expect(outputDuration(m)).toBe(5000 - 500)
    expect(readCompose(m).edit.ranges).toEqual([{ startMs: 0, endMs: 4500 }])
    // A track covering the whole take ends at the end of the output.
    expect(
      trackExtent(pauses, { startOffsetMs: 0, endOffsetMs: 5000 }),
    ).toEqual({ start: 0, end: 4500 })
  })

  it('loads old sessions with defaults from the recorded bubble', () => {
    const c = readCompose(base)
    expect(c.bubble.shape).toBe('circle')
    expect(c.bubble.placement).toEqual(base.bubble!.placement)
    expect(c.edit.ranges).toEqual([{ startMs: 0, endMs: 4000 }])
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
