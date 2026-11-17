import { computeEnvelope, type Envelope } from './envelope'

export interface PreparedAudio {
  /** 16 kHz mono, as Whisper wants. */
  samples: Float32Array
  envelope: Envelope
  durationMs: number
}

/**
 * Decode a recorded file, down-mix to mono at 16 kHz for the model and
 * compute a 10 ms energy envelope (for snapping cuts to silence).
 * `offsetMs` is where the file starts on the output timeline.
 */
export async function prepareAudio(
  blob: Blob,
  offsetMs: number,
): Promise<PreparedAudio | null> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const mono = mixDown(decoded)
    const envelope = computeEnvelope(mono, decoded.sampleRate, 10, offsetMs)
    const frames = Math.max(1, Math.ceil(decoded.duration * 16000))
    const off = new OfflineAudioContext(1, frames, 16000)
    const src = off.createBufferSource()
    const buf = off.createBuffer(1, mono.length, decoded.sampleRate)
    buf.copyToChannel(mono as Float32Array<ArrayBuffer>, 0)
    src.buffer = buf
    src.connect(off.destination)
    src.start()
    const rendered = await off.startRendering()
    return {
      samples: rendered.getChannelData(0).slice(),
      envelope,
      durationMs: decoded.duration * 1000,
    }
  } catch {
    return null
  } finally {
    void ctx.close()
  }
}

function mixDown(a: AudioBuffer): Float32Array {
  if (a.numberOfChannels === 1) return a.getChannelData(0)
  const out = new Float32Array(a.length)
  for (let c = 0; c < a.numberOfChannels; c++) {
    const d = a.getChannelData(c)
    for (let i = 0; i < d.length; i++) out[i] += d[i] / a.numberOfChannels
  }
  return out
}
