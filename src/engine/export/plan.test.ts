import { describe, expect, it } from 'vitest'
import {
  PRESETS,
  estimateBytes,
  formatBytes,
  normaliseGain,
  videoBitrate,
} from './plan'

describe('export plan', () => {
  it('higher quality, resolution and fps mean bigger files', () => {
    const base = PRESETS[0].settings
    const a = estimateBytes({ ...base, quality: 'small' }, 60_000)
    const b = estimateBytes({ ...base, quality: 'high' }, 60_000)
    expect(b).toBeGreaterThan(a)
    expect(estimateBytes({ ...base, maxHeight: 720 }, 60_000)).toBeLessThan(
      estimateBytes({ ...base, maxHeight: 1080 }, 60_000),
    )
    expect(estimateBytes({ ...base, fps: 60 }, 60_000)).toBeGreaterThan(
      estimateBytes({ ...base, fps: 30 }, 60_000),
    )
  })

  it('mute drops the audio share of the estimate', () => {
    const base = PRESETS[0].settings
    const withAudio = estimateBytes(base, 60_000)
    const muted = estimateBytes(
      { ...base, audio: { ...base.audio, mute: true } },
      60_000,
    )
    expect(muted).toBeLessThan(withAudio)
    expect(estimateBytes(base, 60_000, 16 / 9, false)).toBe(muted)
  })

  it('estimates are plausible for a 1080p30 minute', () => {
    const mb = estimateBytes(PRESETS[0].settings, 60_000) / 1024 / 1024
    expect(mb).toBeGreaterThan(5)
    expect(mb).toBeLessThan(60)
  })

  it('videoBitrate scales with pixels', () => {
    expect(videoBitrate(1920, 1080, 30, 'balanced')).toBeGreaterThan(
      videoBitrate(1280, 720, 30, 'balanced'),
    )
  })

  it('normaliseGain never silences and is capped', () => {
    expect(normaliseGain(0)).toBe(1)
    expect(normaliseGain(0.5)).toBeCloseTo(1.78)
    expect(normaliseGain(0.001)).toBe(8)
  })

  it('formats sizes', () => {
    expect(formatBytes(500 * 1024)).toBe('500 KB')
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB')
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB')
  })
})
