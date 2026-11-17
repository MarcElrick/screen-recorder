import { describe, expect, it } from 'vitest'
import { planSync } from './sync'

const extent = { start: 1000, end: 4000 }

describe('planSync', () => {
  it('is inactive before the track starts and after it ends', () => {
    expect(
      planSync({ outputMs: 500, extent, currentTime: 0, playing: true }),
    ).toEqual({
      active: false,
      seekTo: null,
      shouldPlay: false,
    })
    expect(
      planSync({ outputMs: 4500, extent, currentTime: 3, playing: true })
        .active,
    ).toBe(false)
  })

  it('maps the playhead to media time and seeks on drift', () => {
    const p = planSync({
      outputMs: 2000,
      extent,
      currentTime: 0,
      playing: false,
    })
    expect(p).toEqual({ active: true, seekTo: 1, shouldPlay: false })
  })

  it('tolerates small drift while playing but not while scrubbing', () => {
    const near = { outputMs: 2000, extent, currentTime: 1.05 }
    expect(planSync({ ...near, playing: true }).seekTo).toBeNull()
    expect(planSync({ ...near, playing: false }).seekTo).toBe(1)
    expect(planSync({ ...near, currentTime: 1.2, playing: true }).seekTo).toBe(
      1,
    )
  })
})
