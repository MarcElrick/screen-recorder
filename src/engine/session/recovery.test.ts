import { describe, expect, it } from 'vitest'
import { trackEndOffset } from './recovery'

describe('trackEndOffset', () => {
  it('adds pauses that fall inside the recorded span', () => {
    // 10 s of media from raw 1000, with a 2 s pause at raw 4000
    expect(trackEndOffset(1000, 10_000, [{ from: 4000, to: 6000 }])).toBe(
      13_000,
    )
  })
  it('ignores pauses outside the track', () => {
    expect(trackEndOffset(1000, 5000, [{ from: 20_000, to: 21_000 }])).toBe(
      6000,
    )
    expect(trackEndOffset(5000, 5000, [{ from: 1000, to: 2000 }])).toBe(10_000)
  })
  it('handles several pauses in order', () => {
    expect(
      trackEndOffset(0, 10_000, [
        { from: 8000, to: 9000 },
        { from: 3000, to: 4000 },
      ]),
    ).toBe(12_000)
  })
})
