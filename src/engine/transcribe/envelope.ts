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
 * Move `ms` to the quietest point within +/- `radiusMs`, limited to
 * [minMs, maxMs]. Ties go to the point nearest the original.
 */
export function snapToSilence(
  env: Envelope | null,
  ms: number,
  radiusMs: number,
  minMs: number,
  maxMs: number,
): number {
  const clamp = (v: number): number => Math.min(Math.max(v, minMs), maxMs)
  if (!env || env.rms.length === 0 || maxMs < minMs) return clamp(ms)
  const w = env.windowMs
  const lo = Math.max(minMs, ms - radiusMs)
  const hi = Math.min(maxMs, ms + radiusMs)
  if (hi < lo) return clamp(ms)
  let best = clamp(ms)
  let bestVal = Infinity
  const off = env.offsetMs ?? 0
  const first = Math.floor((lo - off) / w)
  const last = Math.floor((hi - off) / w)
  for (let i = first; i <= last && i < env.rms.length; i++) {
    if (i < 0) continue
    const at = clamp(off + i * w + w / 2)
    const v = env.rms[i]
    if (
      v < bestVal - 1e-9 ||
      (Math.abs(v - bestVal) <= 1e-9 && Math.abs(at - ms) < Math.abs(best - ms))
    ) {
      bestVal = v
      best = at
    }
  }
  return best
}
