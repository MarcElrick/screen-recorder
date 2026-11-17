/** A source of media (screen, camera, microphone). */
export type CaptureKind = 'screen' | 'camera' | 'audio'

export interface CaptureSource {
  readonly id: string
  readonly kind: CaptureKind
  /** Prompt for permission (if needed) and begin capturing. */
  start(): Promise<MediaStream>
  stop(): void
}
