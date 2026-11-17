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

/** Bump when alignWords changes so stored transcripts are re-aligned. */
export const ALIGN_VERSION = 2

export const DEFAULT_ALIGN_OPTIONS: AlignOptions = {
  maxShiftMs: 200,
  leadMs: 15,
  tailMs: 10,
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

  // Pass 1: detect each word's edges from the audio, from Whisper's raw times.
  const raw = words.map((x) => ({
    startMs: x.rawStartMs ?? x.startMs,
    endMs: x.rawEndMs ?? x.endMs,
  }))
  const det = raw.map((r, k) => {
    const prevEnd = k > 0 ? raw[k - 1].endMs : 0
    const nextStart = k + 1 < raw.length ? raw[k + 1].startMs : Infinity
    const startLo = Math.max(prevEnd, r.startMs - opts.maxShiftMs)
    const startHi = Math.min(
      r.endMs - opts.minWordMs,
      r.startMs + opts.maxShiftMs,
    )
    const onset =
      startHi >= startLo ? findOnset(r.startMs, startLo, startHi) : null
    const endHi = Math.min(nextStart, r.endMs + opts.maxShiftMs)
    const endLo = Math.max(
      r.startMs + opts.minWordMs,
      r.endMs - opts.maxShiftMs,
    )
    const offset = endHi >= endLo ? findOffset(r.endMs, endLo, endHi) : null
    return {
      start: onset === null ? null : onset - opts.leadMs,
      end: offset === null ? null : offset + opts.tailMs,
    }
  })
  // Whisper's timestamps are often late by a fairly constant amount. Where
  // the audio gives a clear edge we can measure that lag, and apply it to the
  // words (fluent speech) that have no gap to find an edge in.
  const median = (xs: number[]): number => {
    if (xs.length < 4) return 0
    const s = [...xs].sort((a, b) => a - b)
    return Math.max(-250, Math.min(250, s[Math.floor(s.length / 2)]))
  }
  const lagStart = median(
    det.flatMap((d, k) => (d.start === null ? [] : [raw[k].startMs - d.start])),
  )
  const lagEnd = median(
    det.flatMap((d, k) => (d.end === null ? [] : [raw[k].endMs - d.end])),
  )
  const out = words.map((x) => ({ ...x }))
  for (let k = 0; k < out.length; k++) {
    const r = raw[k]
    const d = det[k]
    let start = d.start ?? r.startMs - lagStart
    start = Math.max(start, 0)
    let end = d.end ?? r.endMs - lagEnd
    end = Math.max(end, start + opts.minWordMs)
    out[k].rawStartMs = r.startMs
    out[k].rawEndMs = r.endMs
    out[k].startMs = Math.round(start)
    out[k].endMs = Math.round(end)
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
