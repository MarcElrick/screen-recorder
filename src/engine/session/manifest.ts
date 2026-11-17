import type { Placement } from '../compositing/types'
import type { BubbleSettings } from '../compositing/placement'
import type { Interval } from '../recording/clock'
import type { TrackResult } from '../recording/track-recorder'

export interface ManifestTrack {
  kind: 'screen' | 'camera'
  file: string
  mime: string
  startOffsetMs: number
  endOffsetMs: number
  endedEarly: boolean
  sizeBytes: number
}

export interface SessionManifest {
  version: 1
  id: string
  createdAt: string
  durationMs: number
  /** Raw-clock intervals where recording was paused. */
  pauses: Interval[]
  tracks: ManifestTrack[]
  /** Starting placement for the camera bubble; freely movable in Compose. */
  bubble: { settings: BubbleSettings; placement: Placement } | null
}

export function buildManifest(args: {
  id: string
  createdAt: Date
  durationMs: number
  pauses: Interval[]
  tracks: TrackResult[]
  bubble: SessionManifest['bubble']
}): SessionManifest {
  return {
    version: 1,
    id: args.id,
    createdAt: args.createdAt.toISOString(),
    durationMs: Math.round(args.durationMs),
    pauses: args.pauses.map((p) => ({
      from: Math.round(p.from),
      to: Math.round(p.to),
    })),
    tracks: args.tracks.map((t) => ({
      kind: t.kind,
      file: t.file,
      mime: t.mime,
      startOffsetMs: Math.round(t.startOffsetMs),
      endOffsetMs: Math.round(t.endOffsetMs),
      endedEarly: t.endedEarly,
      sizeBytes: t.blob.size,
    })),
    bubble: args.bubble,
  }
}
