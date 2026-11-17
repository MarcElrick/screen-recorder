import type { SessionClock } from './clock'
import type { ChunkSink } from '../storage/sink'

const STOP_TIMEOUT_MS = 5000

export type TrackKind = 'screen' | 'camera'

export interface TrackResult {
  kind: TrackKind
  file: string
  mime: string
  blob: Blob
  /** Raw ms on the session clock when this track started. */
  startOffsetMs: number
  /** Raw ms on the session clock when this track ended. */
  endOffsetMs: number
  endedEarly: boolean
  /** Whether the recorded stream carried an audio track. */
  hasAudio: boolean
}

export interface TrackRecorderOptions {
  kind: TrackKind
  file: string
  stream: MediaStream
  mime?: string
  sink: ChunkSink
  clock: SessionClock
  timesliceMs?: number
  /** Called when a track on the stream ends by itself (unplugged, stop sharing). */
  onEnded?: (kind: TrackKind) => void
  onError?: (kind: TrackKind, err: unknown) => void
}

/** One MediaRecorder streaming chunks into a sink. */
export class TrackRecorder {
  private recorder: MediaRecorder
  private writes: Promise<void> = Promise.resolve()
  private startOffsetMs = 0
  private endOffsetMs = 0
  private endedEarly = false
  private stopped = false
  private failed = false
  private readonly hasAudio: boolean

  constructor(private readonly o: TrackRecorderOptions) {
    this.hasAudio = o.stream.getAudioTracks().length > 0
    this.recorder = new MediaRecorder(
      o.stream,
      o.mime ? { mimeType: o.mime } : undefined,
    )
    this.recorder.ondataavailable = (e) => {
      if (!e.data.size || this.failed) return
      this.writes = this.writes
        .then(() => o.sink.write(e.data))
        .catch((err) => {
          this.failed = true
          o.onError?.(o.kind, err)
        })
    }
    this.recorder.onerror = (e) => o.onError?.(o.kind, e)
    for (const t of o.stream.getTracks()) {
      t.addEventListener('ended', this.handleEnded)
    }
  }

  private handleEnded = (): void => {
    if (this.stopped) return
    // Only treat the track as ended when every track on the stream is dead.
    if (this.o.stream.getTracks().some((t) => t.readyState === 'live')) return
    this.endedEarly = true
    this.o.onEnded?.(this.o.kind)
  }

  get kind(): TrackKind {
    return this.o.kind
  }
  get file(): string {
    return this.o.file
  }
  get mimeType(): string {
    return this.recorder.mimeType || this.o.mime || 'video/webm'
  }
  get startOffset(): number {
    return this.startOffsetMs
  }
  get hasAudioTrack(): boolean {
    return this.hasAudio
  }

  start(): void {
    this.startOffsetMs = this.o.clock.offset()
    this.recorder.start(this.o.timesliceMs ?? 1000)
  }

  pause(): void {
    if (this.recorder.state === 'recording') this.recorder.pause()
  }

  resume(): void {
    if (this.recorder.state === 'paused') this.recorder.resume()
  }

  async stop(): Promise<TrackResult> {
    this.stopped = true
    for (const t of this.o.stream.getTracks())
      t.removeEventListener('ended', this.handleEnded)
    if (this.recorder.state !== 'inactive') {
      // Some browsers never fire 'stop' (e.g. if the source already ended), so
      // don't wait forever; whatever chunks arrived are still saved.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STOP_TIMEOUT_MS)
        this.recorder.onstop = () => {
          clearTimeout(timer)
          resolve()
        }
        try {
          this.recorder.stop()
        } catch {
          clearTimeout(timer)
          resolve()
        }
      })
    }
    this.endOffsetMs = this.o.clock.offset()
    await this.writes
    const blob = await this.o.sink.close()
    for (const t of this.o.stream.getTracks()) t.stop()
    return {
      kind: this.o.kind,
      file: this.o.file,
      mime: this.recorder.mimeType || this.o.mime || 'video/webm',
      blob,
      startOffsetMs: this.startOffsetMs,
      endOffsetMs: this.endOffsetMs,
      endedEarly: this.endedEarly,
      hasAudio: this.hasAudio,
    }
  }
}
