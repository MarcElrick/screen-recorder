import type { ExportFormat } from './exporter'

export type Quality = 'small' | 'balanced' | 'high'
export type Fps = 24 | 30 | 60

export interface AudioSettings {
  mute: boolean
  /** Scale the mic to a consistent peak level. */
  normalise: boolean
  /** Extra gain, 1 = unchanged. */
  gain: number
}

export interface ExportSettings {
  format: ExportFormat
  maxHeight: number
  fps: Fps
  quality: Quality
  audio: AudioSettings
}

export type PresetId = 'share' | 'archive' | 'small'

export const PRESETS: {
  id: PresetId
  label: string
  hint: string
  settings: ExportSettings
}[] = [
  {
    id: 'share',
    label: 'Share online',
    hint: 'MP4, 1080p, 30 fps',
    settings: {
      format: 'mp4',
      maxHeight: 1080,
      fps: 30,
      quality: 'balanced',
      audio: { mute: false, normalise: true, gain: 1 },
    },
  },
  {
    id: 'archive',
    label: 'Slides archive',
    hint: 'WebM, up to 4K, high quality',
    settings: {
      format: 'webm',
      maxHeight: 2160,
      fps: 30,
      quality: 'high',
      audio: { mute: false, normalise: false, gain: 1 },
    },
  },
  {
    id: 'small',
    label: 'Small file',
    hint: 'MP4, 720p, 24 fps',
    settings: {
      format: 'mp4',
      maxHeight: 720,
      fps: 24,
      quality: 'small',
      audio: { mute: false, normalise: true, gain: 1 },
    },
  },
]

/** Bits per pixel per frame. Screen content compresses far better than camera footage. */
const BPP: Record<Quality, number> = { small: 0.03, balanced: 0.07, high: 0.14 }
const AUDIO_BPS: Record<Quality, number> = {
  small: 64_000,
  balanced: 128_000,
  high: 192_000,
}

export function videoBitrate(
  width: number,
  height: number,
  fps: number,
  q: Quality,
): number {
  return Math.round(width * height * fps * BPP[q])
}

export function audioBitrate(q: Quality): number {
  return AUDIO_BPS[q]
}

/** Rough output size in bytes for a take of `durationMs` at the given settings. */
export function estimateBytes(
  s: ExportSettings,
  durationMs: number,
  sourceAspect = 16 / 9,
  hasAudio = true,
): number {
  const h = s.maxHeight
  const w = Math.round(h * sourceAspect)
  const bps =
    videoBitrate(w, h, s.fps, s.quality) +
    (hasAudio && !s.audio.mute ? audioBitrate(s.quality) : 0)
  return Math.round((bps * durationMs) / 1000 / 8)
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024)
    return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/** Peak-normalise factor so the loudest sample reaches ~-1 dBFS (capped, never silences). */
export function normaliseGain(peak: number): number {
  if (!(peak > 0.0001)) return 1
  return Math.min(8, 0.89 / peak)
}
