import type { Envelope } from './envelope'
import type { Word } from './types'

export interface AlignOptions {
  /** How far a word edge may move outward / inward from Whisper's guess. */
  maxShiftMs: number
  /** Kept before the detected onset, so the attack isn't clipped. */
  leadMs: number
  /** Kept after the detected offset, for the tail of the word. */
  tailMs: number
  /** Shortest word we keep after alignment. */
  minWordMs: number
}

export const DEFAULT_ALIGN_OPTIONS: AlignOptions = {
  maxShiftMs: 200,
  leadMs: 15,
  tailMs: 25,
  minWordMs: 40,
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/**
 * Whisper's word times come from attention alignment and are often 50-200 ms
 * off. This moves each word's start to the real speech onset and its end to
 * the real offset, using the audio energy: where Whisper's edge sits inside
 * speech it walks outward to where the energy falls to the noise floor, and
 * where it sits in silence it walks inward to the first speech. Edges never
 * cross a neighbour, and a word with no clear edge keeps its original time.
 */
export function alignWords(
  words: Word[],
  env: Envelope | null,
  opts: AlignOptions = DEFAULT_ALIGN_OPTIONS,
): Word[] {
  if (!env || env.rms.length < 10 || words.length === 0)
    return words.map((w) => ({ ...w }))
  const w = env.windowMs
  const off = env.offsetMs ?? 0
  // Light smoothing so single noisy windows don't count as an edge.
  const e = env.rms.map((_, i, a) => {
    const lo = Math.max(0, i - 1)
    const hi = Math.min(a.length - 1, i + 1)
    let s = 0
    for (let j = lo; j <= hi; j++) s += a[j]
    return s / (hi - lo + 1)
  })
  const sorted = [...e].sort((a, b) => a - b)
  const floor = percentile(sorted, 0.1)
  const peak = percentile(sorted, 0.9)
  if (peak <= floor * 1.5) return words.map((x) => ({ ...x })) // no clear speech
  const thr = floor + (peak - floor) * 0.12
  const at = (ms: number): number => Math.floor((ms - off) / w)
  const timeOf = (i: number): number => off + i * w
  const loud = (i: number): boolean => i >= 0 && i < e.length && e[i] > thr
  const minRun = Math.max(1, Math.round(30 / w))
  /** True when `i` begins a run of at least `minRun` loud windows. */
  const sustained = (i: number): boolean => {
    for (let k = 0; k < minRun; k++) if (!loud(i + k)) return false
    return true
  }

  /** Onset near `ms`, searching [lo, hi]; null when there is no clear edge. */
  const findOnset = (ms: number, lo: number, hi: number): number | null => {
    const iLo = at(lo)
    const iHi = at(hi)
    const i0 = at(ms)
    if (loud(i0)) {
      // Inside speech: walk back to where it began.
      let i = i0
      while (i - 1 >= iLo && loud(i - 1)) i--
      return i - 1 < iLo && loud(i - 1) ? null : timeOf(i)
    }
    for (let i = i0; i <= iHi; i++) if (sustained(i)) return timeOf(i)
    return null
  }
  /** Offset near `ms`, searching [lo, hi]. */
  const findOffset = (ms: number, lo: number, hi: number): number | null => {
    const iLo = at(lo)
    const iHi = at(hi)
    const i0 = at(ms)
    if (loud(i0)) {
      let i = i0
      while (i + 1 <= iHi && loud(i + 1)) i++
      return i + 1 > iHi && loud(i + 1) ? null : timeOf(i + 1)
    }
    for (let i = i0; i >= iLo; i--) if (loud(i)) return timeOf(i + 1)
    return null
  }

  const out = words.map((x) => ({ ...x }))
  for (let k = 0; k < out.length; k++) {
    const cur = out[k]
    const prevEnd = k > 0 ? out[k - 1].endMs : 0
    const nextStart = k + 1 < words.length ? words[k + 1].startMs : Infinity
    const startLo = Math.max(prevEnd, cur.startMs - opts.maxShiftMs)
    const startHi = Math.min(
      cur.endMs - opts.minWordMs,
      cur.startMs + opts.maxShiftMs,
    )
    const onset =
      startHi >= startLo ? findOnset(cur.startMs, startLo, startHi) : null
    let start = cur.startMs
    if (onset !== null) start = Math.max(startLo, onset - opts.leadMs)
    start = Math.min(Math.max(start, startLo), Math.max(startLo, startHi))

    const endHi = Math.min(nextStart, cur.endMs + opts.maxShiftMs)
    const endLo = Math.max(start + opts.minWordMs, cur.endMs - opts.maxShiftMs)
    const offset = endHi >= endLo ? findOffset(cur.endMs, endLo, endHi) : null
    let end = cur.endMs
    if (offset !== null) end = Math.min(endHi, offset + opts.tailMs)
    end = Math.max(
      Math.min(end, Math.max(endLo, endHi)),
      start + opts.minWordMs,
    )

    cur.startMs = Math.round(start)
    cur.endMs = Math.round(end)
  }
  // Keep strictly ordered even when two words touch.
  for (let k = 1; k < out.length; k++)
    if (out[k].startMs < out[k - 1].endMs) {
      const mid = Math.round((out[k].startMs + out[k - 1].endMs) / 2)
      out[k - 1].endMs = Math.max(out[k - 1].startMs + 1, mid)
      out[k].startMs = Math.max(out[k - 1].endMs, mid)
      if (out[k].endMs <= out[k].startMs) out[k].endMs = out[k].startMs + 1
    }
  return out
}
