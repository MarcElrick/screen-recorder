export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped'

/** Encodes a stream into a downloadable file. Phase 1: WebM via MediaRecorder. */
export interface Encoder {
  readonly state: RecorderState
  start(stream: MediaStream): void
  pause(): void
  resume(): void
  stop(): Promise<Blob>
}
