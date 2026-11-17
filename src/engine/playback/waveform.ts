/** Reduce samples to `buckets` peak values in 0..1. */
export function computePeaks(samples: Float32Array, buckets: number): number[] {
  const out: number[] = []
  if (buckets <= 0 || samples.length === 0)
    return new Array<number>(Math.max(buckets, 0)).fill(0)
  const size = samples.length / buckets
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size)
    const to = Math.max(from + 1, Math.floor((b + 1) * size))
    let peak = 0
    for (let i = from; i < to && i < samples.length; i++) {
      const v = Math.abs(samples[i])
      if (v > peak) peak = v
    }
    out.push(Math.min(1, peak))
  }
  return out
}

/** Decode an audio-bearing blob and return peaks (browser only). */
export async function decodePeaks(
  blob: Blob,
  buckets = 800,
): Promise<number[] | null> {
  try {
    const ctx = new AudioContext()
    try {
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
      return computePeaks(audio.getChannelData(0), buckets)
    } finally {
      void ctx.close()
    }
  } catch {
    return null
  }
}
