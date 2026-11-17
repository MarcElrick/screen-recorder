import { describe, expect, it } from 'vitest'
import { alignWords } from './align'
import type { Envelope } from './envelope'
import type { Word } from './types'

/** Envelope with speech at the given [start, end] ms ranges over a quiet floor. */
function env(
  total: number,
  speech: [number, number][],
  offsetMs = 0,
): Envelope {
  const rms: number[] = []
  for (let t = 0; t < total; t += 10) {
    const on = speech.some(([a, b]) => t + offsetMs >= a && t + offsetMs < b)
    rms.push(on ? 0.3 : 0.005)
  }
  return { windowMs: 10, rms, offsetMs }
}
const word = (id: number, startMs: number, endMs: number): Word => ({
  id: `w${id}`,
  text: 'x',
  startMs,
  endMs,
})

describe('alignWords', () => {
  const e = env(3000, [
    [500, 900],
    [1500, 2000],
  ])

  it('pulls late and early edges to the real speech', () => {
    // Whisper says 600-1050 for a word actually spoken 500-900.
    const [a] = alignWords([word(0, 600, 1050)], e)
    expect(a.startMs).toBeGreaterThanOrEqual(470)
    expect(a.startMs).toBeLessThanOrEqual(500)
    expect(a.endMs).toBeGreaterThanOrEqual(900)
    expect(a.endMs).toBeLessThanOrEqual(940)
  })

  it('moves a start that sits in silence forward to the onset', () => {
    const [a] = alignWords([word(0, 1350, 1900)], e)
    expect(a.startMs).toBeGreaterThanOrEqual(1460)
    expect(a.startMs).toBeLessThanOrEqual(1500)
  })

  it('never crosses a neighbour', () => {
    const out = alignWords([word(0, 450, 950), word(1, 1400, 2100)], e)
    expect(out[0].endMs).toBeLessThanOrEqual(out[1].startMs)
    expect(out[1].startMs).toBeGreaterThanOrEqual(out[0].endMs)
    expect(out[1].endMs).toBeGreaterThan(out[1].startMs)
  })

  it('honours the envelope offset', () => {
    const shifted = env(3000, [[5500, 5900]], 5000)
    const [a] = alignWords([word(0, 5600, 6000)], shifted)
    expect(a.startMs).toBeLessThanOrEqual(5500)
    expect(a.startMs).toBeGreaterThanOrEqual(5470)
  })

  it('leaves words alone with no envelope or no clear speech', () => {
    const w = [word(0, 100, 400)]
    expect(alignWords(w, null)).toEqual(w)
    const flat: Envelope = { windowMs: 10, rms: new Array(300).fill(0.1) }
    expect(alignWords(w, flat)).toEqual(w)
  })

  it('does not mutate its input and keeps words ordered', () => {
    const input = [word(0, 600, 1050), word(1, 1050, 1700)]
    const copy = structuredClone(input)
    const out = alignWords(input, e)
    expect(input).toEqual(copy)
    expect(out[1].startMs).toBeGreaterThanOrEqual(out[0].endMs)
  })
})

describe('systematic lag', () => {
  it('measures a constant lag from clear edges and applies it to fluent words', () => {
    const e = env(7000, [
      [500, 900],
      [1500, 1900],
      [2500, 2900],
      [3500, 3900],
      [4500, 5300],
    ])
    const lag = 80
    const truth: [number, number][] = [
      [500, 900],
      [1500, 1900],
      [2500, 2900],
      [3500, 3900],
      [4500, 4900],
      [4900, 5300],
    ]
    const words = truth.map(([a, b], i) => word(i, a + lag, b + lag))
    const out = alignWords(words, e)
    // The second fluent word has no silence to find; the measured lag fixes it.
    expect(Math.abs(out[5].startMs - 4900)).toBeLessThanOrEqual(35)
    expect(out[5].startMs).toBeLessThan(4900 + lag - 30)
    // Original times are kept so alignment can be redone.
    expect(out[5].rawStartMs).toBe(4900 + lag)
    // Re-aligning aligned words starts again from the raw times.
    const again = alignWords(out, e)
    expect(again.map((w) => w.startMs)).toEqual(out.map((w) => w.startMs))
  })
})
