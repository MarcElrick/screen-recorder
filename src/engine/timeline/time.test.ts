import { describe, expect, it } from 'vitest'
import {
  outputToRaw,
  pauseMarkers,
  pausedBefore,
  rawToOutput,
  totalOutputMs,
  trackExtent,
} from './time'

const pauses = [
  { from: 1000, to: 1500 },
  { from: 3000, to: 3200 },
]

describe('time mapping', () => {
  it('removes pauses from raw time', () => {
    expect(rawToOutput(pauses, 500)).toBe(500)
    expect(rawToOutput(pauses, 1200)).toBe(1000)
    expect(rawToOutput(pauses, 2000)).toBe(1500)
    expect(rawToOutput(pauses, 4000)).toBe(3300)
    expect(pausedBefore(pauses, 4000)).toBe(700)
  })

  it('round-trips output to raw outside pauses', () => {
    for (const o of [0, 400, 1000, 1700, 2900]) {
      expect(rawToOutput(pauses, outputToRaw(pauses, o))).toBe(o)
    }
    expect(outputToRaw(pauses, 1000)).toBe(1500)
  })

  it('computes total output duration', () => {
    expect(totalOutputMs(4000, pauses)).toBe(3300)
  })

  it('places late-starting and early-ending tracks', () => {
    expect(
      trackExtent(pauses, { startOffsetMs: 0, endOffsetMs: 4000 }),
    ).toEqual({
      start: 0,
      end: 3300,
    })
    // camera starts during the first pause and ends mid-way
    expect(
      trackExtent(pauses, { startOffsetMs: 1200, endOffsetMs: 2500 }),
    ).toEqual({ start: 1000, end: 2000 })
  })

  it('lists pause markers on the output timeline', () => {
    expect(pauseMarkers(pauses)).toEqual([1000, 2500])
  })
})
