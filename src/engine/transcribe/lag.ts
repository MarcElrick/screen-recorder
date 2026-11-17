import type { Envelope } from './envelope'
import type { Word } from './types'

/** Where speech is, from the energy envelope: one flag per window. */
export interface SpeechMask {
  windowMs: number
  offsetMs: number
  loud: Uint8Array
  /** Energy level that separates speech from the noise floor. */
  threshold: number
}

function percentile(sorted: number[], p: number): number {
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
    : 0
}

/** Speech/silence mask, or null when the audio has no clear speech. */
export function speechMask(env: Envelope | null): SpeechMask | null {
  if (!env || env.rms.length < 10) return null
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
  if (peak <= floor * 1.5) return null
  const threshold = floor + (peak - floor) * 0.12
  const loud = new Uint8Array(e.length)
  for (let i = 0; i < e.length; i++) loud[i] = e[i] > threshold ? 1 : 0
  // Close dips shorter than 60 ms inside a word.
  const maxDip = Math.max(1, Math.round(60 / env.windowMs))
  let i = 0
  while (i < loud.length) {
    if (loud[i]) {
      i++
      continue
    }
    let j = i
    while (j < loud.length && !loud[j]) j++
    if (i > 0 && j < loud.length && j - i <= maxDip) loud.fill(1, i, j)
    i = j
  }
  return {
    windowMs: env.windowMs,
    offsetMs: env.offsetMs ?? 0,
    loud,
    threshold,
  }
}

export interface LagOptions {
  /** Whisper being early (negative) or late (positive), searched in this range. */
  minLagMs: number
  maxLagMs: number
  stepMs: number
  /** Words in a window are fitted together; longer takes get several windows. */
  windowMs: number
  /** Least words needed to trust a window. */
  minWords: number
}

export const DEFAULT_LAG_OPTIONS: LagOptions = {
  minLagMs: -250,
  maxLagMs: 600,
  stepMs: 10,
  windowMs: 20000,
  minWords: 4,
}

/**
 * The time shift that best lays these words over the speech in the audio.
 * `lag` is how late the words are (true time = word time - lag). Words are
 * scored by how much of them lies inside speech, with a mild preference for
 * small shifts so evenly paced speech doesn't lock onto the next word.
 */
export function bestLag(
  words: { startMs: number; endMs: number }[],
  mask: SpeechMask,
  opts: LagOptions = DEFAULT_LAG_OPTIONS,
): number {
  const n = mask.loud.length
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + mask.loud[i]
  const idx = (ms: number): number =>
    Math.min(n, Math.max(0, Math.round((ms - mask.offsetMs) / mask.windowMs)))
  const total = words.reduce((s, w) => s + (w.endMs - w.startMs), 0)
  if (total <= 0) return 0
  let best = 0
  let bestScore = -Infinity
  for (let lag = opts.minLagMs; lag <= opts.maxLagMs; lag += opts.stepMs) {
    let covered = 0
    for (const w of words) {
      const a = idx(w.startMs - lag)
      const b = idx(w.endMs - lag)
      covered += (prefix[b] - prefix[a]) * mask.windowMs
    }
    const score = covered / total - Math.abs(lag) / 8000
    if (score > bestScore + 1e-9) {
      bestScore = score
      best = lag
    }
  }
  return best
}

/** Lag over time: fitted in windows, so drift is followed. */
export interface LagCurve {
  at: number[]
  lag: number[]
}

export function lagCurve(
  words: { startMs: number; endMs: number }[],
  mask: SpeechMask | null,
  opts: LagOptions = DEFAULT_LAG_OPTIONS,
): LagCurve {
  if (!mask || words.length < opts.minWords) return { at: [], lag: [] }
  const first = words[0].startMs
  const last = words[words.length - 1].endMs
  const span = last - first
  if (span <= opts.windowMs * 1.25)
    return { at: [(first + last) / 2], lag: [bestLag(words, mask, opts)] }
  const at: number[] = []
  const lag: number[] = []
  const step = opts.windowMs / 2
  for (let t0 = first; t0 < last; t0 += step) {
    const t1 = Math.min(last, t0 + opts.windowMs)
    const inWin = words.filter((w) => {
      const mid = (w.startMs + w.endMs) / 2
      return mid >= t0 && mid < t1
    })
    if (inWin.length >= opts.minWords) {
      at.push((t0 + t1) / 2)
      lag.push(bestLag(inWin, mask, opts))
    }
    if (t1 >= last) break
  }
  return { at, lag }
}

export function lagAt(curve: LagCurve, ms: number): number {
  const { at, lag } = curve
  if (!at.length) return 0
  if (ms <= at[0]) return lag[0]
  if (ms >= at[at.length - 1]) return lag[lag.length - 1]
  let i = 1
  while (at[i] < ms) i++
  const f = (ms - at[i - 1]) / (at[i] - at[i - 1])
  return lag[i - 1] + (lag[i] - lag[i - 1]) * f
}

/** Words moved earlier by the lag measured against the audio (raw times kept). */
export function correctLag(
  words: Word[],
  env: Envelope | null,
  opts: LagOptions = DEFAULT_LAG_OPTIONS,
): { words: Word[]; curve: LagCurve } {
  const raw = words.map((w) => ({
    startMs: w.rawStartMs ?? w.startMs,
    endMs: w.rawEndMs ?? w.endMs,
  }))
  const curve = lagCurve(raw, speechMask(env), opts)
  return {
    curve,
    words: words.map((w, i) => {
      const mid = (raw[i].startMs + raw[i].endMs) / 2
      const lag = lagAt(curve, mid)
      return {
        ...w,
        rawStartMs: raw[i].startMs,
        rawEndMs: raw[i].endMs,
        startMs: Math.max(0, Math.round(raw[i].startMs - lag)),
        endMs: Math.max(1, Math.round(raw[i].endMs - lag)),
      }
    }),
  }
}
