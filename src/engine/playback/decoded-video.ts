import { demuxWebmVideo, type DemuxedVideo } from './webm-demux'

/** How many frames behind/ahead of the wanted one we keep decoded. */
const KEEP_BEHIND = 3
const LOOKAHEAD = 12
const MAX_QUEUE = 6

/**
 * Frame-accurate video from WebCodecs. `frameAt` is synchronous (for the draw
 * loop): it returns the latest decoded frame at or before the wanted time and
 * schedules decoding in the background. Doesn't touch an HTMLVideoElement, so
 * seeking never stalls on the browser's media pipeline.
 */
export class DecodedVideo {
  private decoder: VideoDecoder
  private cache = new Map<number, VideoFrame>() // by packet index
  private tsToIndex = new Map<number, number>()
  /** Next packet index to feed the decoder. */
  private next = 0
  private wanted = 0
  private generation = 0
  private disposed = false
  private pumping = false
  private waiters = new Map<number, ((f: VideoFrame | null) => void)[]>()
  readonly width: number
  readonly height: number
  readonly durationMs: number

  private constructor(
    private readonly src: DemuxedVideo,
    private readonly indexOfTs: number[],
  ) {
    this.width = src.width
    this.height = src.height
    this.durationMs = src.packets[src.packets.length - 1].ts / 1000
    this.decoder = this.makeDecoder()
  }

  /** Returns null if WebCodecs or this codec isn't available. */
  static async open(blob: Blob): Promise<DecodedVideo | null> {
    if (typeof VideoDecoder === 'undefined') return null
    try {
      const src = demuxWebmVideo(new Uint8Array(await blob.arrayBuffer()))
      if (!src) return null
      const support = await VideoDecoder.isConfigSupported({ codec: src.codec })
      if (!support.supported) return null
      const dv = new DecodedVideo(
        src,
        src.packets.map((p) => p.ts),
      )
      return dv
    } catch {
      return null
    }
  }

  private makeDecoder(): VideoDecoder {
    const d = new VideoDecoder({
      output: (f) => this.onFrame(f, this.generation),
      error: () => {
        // Decoder died: rebuild it lazily on the next request.
        if (!this.disposed) {
          this.decoder = this.makeDecoder()
          this.next = this.keyframeAtOrBefore(this.wanted)
          this.pump()
        }
      },
    })
    d.configure({ codec: this.src.codec })
    return d
  }

  private onFrame(f: VideoFrame, gen: number): void {
    const idx = this.tsToIndex.get(f.timestamp)
    if (this.disposed || gen !== this.generation || idx === undefined) {
      f.close()
      return
    }
    this.cache.get(idx)?.close()
    this.cache.set(idx, f)
    const ws = this.waiters.get(idx)
    if (ws) {
      this.waiters.delete(idx)
      ws.forEach((w) => w(f))
    }
    this.evict()
    this.pump()
  }

  private evict(): void {
    for (const [i, f] of this.cache) {
      if (i < this.wanted - KEEP_BEHIND || i > this.wanted + LOOKAHEAD + 4) {
        f.close()
        this.cache.delete(i)
      }
    }
  }

  private indexAtOrBefore(tsUs: number): number {
    const a = this.indexOfTs
    let lo = 0
    let hi = a.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (a[mid] <= tsUs) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  private keyframeAtOrBefore(i: number): number {
    while (i > 0 && !this.src.packets[i].key) i--
    return i
  }

  /** Latest decoded frame at or before `ms` (track time), or null if none yet. */
  frameAt(ms: number): VideoFrame | null {
    if (this.disposed) return null
    const target = this.indexAtOrBefore(Math.max(0, ms) * 1000)
    if (target !== this.wanted) {
      const jumped =
        target < this.wanted || target > this.wanted + LOOKAHEAD * 2
      this.wanted = target
      if (jumped || target < this.next - LOOKAHEAD - KEEP_BEHIND)
        this.seek(target)
    }
    if (!this.cache.has(target) && this.next <= target) this.pump()
    for (let i = target; i >= Math.max(0, target - 30); i--) {
      const f = this.cache.get(i)
      if (f) return f
    }
    return null
  }

  /**
   * The exact frame at `ms`, waiting for it to be decoded (for export). The
   * frame stays valid until the next `getFrame`/`frameAt` call moves on, so
   * draw it right away. Resolves null if it can't be decoded in time.
   */
  async getFrame(ms: number, timeoutMs = 15_000): Promise<VideoFrame | null> {
    if (this.disposed) return null
    const target = this.indexAtOrBefore(Math.max(0, ms) * 1000)
    this.frameAt(ms) // sets the target, seeks and starts decoding
    const have = this.cache.get(target)
    if (have) return have
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.frameAt(ms)), timeoutMs)
      const list = this.waiters.get(target) ?? []
      list.push((f) => {
        clearTimeout(timer)
        resolve(f)
      })
      this.waiters.set(target, list)
    })
  }

  private seek(target: number): void {
    const key = this.keyframeAtOrBefore(target)
    // Already decoding forward through the wanted frame: just let it run.
    if (this.next > key && this.next <= target + 1 && this.cache.has(key))
      return
    this.generation++
    for (const f of this.cache.values()) f.close()
    this.cache.clear()
    try {
      this.decoder.reset()
      this.decoder.configure({ codec: this.src.codec })
    } catch {
      this.decoder = this.makeDecoder()
    }
    this.next = key
    this.pump()
  }

  private pump(): void {
    if (this.pumping || this.disposed) return
    this.pumping = true
    try {
      const end = Math.min(this.src.packets.length, this.wanted + LOOKAHEAD)
      while (
        this.next < end &&
        this.decoder.state === 'configured' &&
        this.decoder.decodeQueueSize < MAX_QUEUE
      ) {
        const p = this.src.packets[this.next]
        this.tsToIndex.set(p.ts, this.next)
        this.decoder.decode(
          new EncodedVideoChunk({
            type: p.key ? 'key' : 'delta',
            timestamp: p.ts,
            data: p.data,
          }),
        )
        this.next++
      }
    } finally {
      this.pumping = false
    }
  }

  dispose(): void {
    this.disposed = true
    for (const ws of this.waiters.values()) ws.forEach((w) => w(null))
    this.waiters.clear()
    for (const f of this.cache.values()) f.close()
    this.cache.clear()
    try {
      this.decoder.close()
    } catch {
      /* already closed */
    }
  }
}
