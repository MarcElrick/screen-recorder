import { describe, expect, it } from 'vitest'
import { computePeaks } from './waveform'

describe('computePeaks', () => {
  it('takes the max absolute value per bucket', () => {
    const s = new Float32Array([0.1, -0.5, 0.2, 0.9, -0.3, 0])
    expect(computePeaks(s, 3)).toEqual([
      expect.closeTo(0.5),
      expect.closeTo(0.9),
      expect.closeTo(0.3),
    ])
  })
  it('handles empty input', () => {
    expect(computePeaks(new Float32Array(), 4)).toEqual([0, 0, 0, 0])
  })
})
