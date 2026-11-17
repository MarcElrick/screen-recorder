export interface Envelope {
  windowMs: number
  rms: number[]
  /** Output time (ms) of the first window. */
  offsetMs?: number
}

/** Short-window RMS energy of mono audio, one value per `windowMs`. */
export function computeEnvelope(
  samples: Float32Array,
  sampleRate: number,
  windowMs = 10,
  offsetMs = 0,
): Envelope {
  const size = Math.max(1, Math.round((sampleRate * windowMs) / 1000))
  const rms: number[] = []
  for (let i = 0; i < samples.length; i += size) {
    const end = Math.min(samples.length, i + size)
    let sum = 0
    for (let j = i; j < end; j++) sum += samples[j] * samples[j]
    rms.push(Math.sqrt(sum / Math.max(1, end - i)))
  }
  return { windowMs, rms, offsetMs }
}

/**
 * Move `ms` to a quiet point within [ms - backMs, ms + forwardMs], limited to
 * [minMs, maxMs]. Energy is weighted by distance, so in continuous speech
 * (no real silence) the edge stays put instead of wandering to a random dip.
 */
export function snapToSilence(
  env: Envelope | null,
  ms: number,
  backMs: number,
  minMs: number,
  maxMs: number,
  forwardMs = backMs,
): number {
  const clamp = (v: number): number => Math.min(Math.max(v, minMs), maxMs)
  if (!env || env.rms.length === 0 || maxMs < minMs) return clamp(ms)
  const w = env.windowMs
  const lo = Math.max(minMs, ms - backMs)
  const hi = Math.min(maxMs, ms + forwardMs)
  if (hi < lo) return clamp(ms)
  let best = clamp(ms)
  let bestScore = Infinity
  const off = env.offsetMs ?? 0
  const first = Math.floor((lo - off) / w)
  const last = Math.floor((hi - off) / w)
  for (let i = first; i <= last && i < env.rms.length; i++) {
    if (i < 0) continue
    const at = clamp(off + i * w + w / 2)
    const score = env.rms[i] * (1 + Math.abs(at - ms) / 100)
    if (score < bestScore - 1e-12) {
      bestScore = score
      best = at
    }
  }
  return best
}
