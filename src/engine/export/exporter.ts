import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny'
import {
  renderFrame,
  type FrameSource,
  type Layout,
} from '../compositing/render'
import { DecodedVideo } from '../playback/decoded-video'
import {
  audioBitrate,
  normaliseGain,
  videoBitrate,
  type AudioSettings,
  type Quality,
} from './plan'
import type { SessionManifest } from '../session/manifest'
import {
  editedDuration,
  editedToOutput,
  type EditList,
} from '../timeline/editlist'
import { trackExtent } from '../timeline/time'

export type ExportFormat = 'mp4' | 'webm'

export interface ExportOptions {
  /** Encoding quality; also sets the bitrates. Defaults to balanced. */
  quality?: Quality
  audio?: AudioSettings
  manifest: SessionManifest
  edit: EditList
  screen: Blob
  camera: Blob | null
  layout: Layout
  format: ExportFormat
  fps?: number
  /** Cap on the output height (px); the source is never upscaled. */
  maxHeight?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

export interface ExportResult {
  blob: Blob
  mime: string
  extension: string
  videoCodec: string
  audioCodec: string | null
  width: number
  height: number
  durationMs: number
}

export class ExportError extends Error {}

export function exportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined'
  )
}

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2)

/** The composed take as one file, rendered with the same `renderFrame` as the preview. */
export async function exportVideo(o: ExportOptions): Promise<ExportResult> {
  if (!exportSupported())
    throw new ExportError(
      'This browser cannot encode video. Try a recent Chrome, Edge or Safari.',
    )
  const fps = o.fps ?? 30
  const quality = o.quality ?? 'balanced'
  const audioSettings = o.audio ?? { mute: false, normalise: false, gain: 1 }
  const aborted = (): boolean => o.signal?.aborted === true
  const check = (): void => {
    if (aborted()) throw new ExportError('Export cancelled.')
  }

  const screen = await DecodedVideo.open(o.screen)
  if (!screen)
    throw new ExportError("This browser can't decode the screen recording.")
  const camera = o.camera ? await DecodedVideo.open(o.camera) : null
  let output: Output | null = null
  try {
    const st = o.manifest.tracks.find((t) => t.kind === 'screen')
    const ct = o.manifest.tracks.find((t) => t.kind === 'camera')
    const sExt = st
      ? trackExtent(o.manifest.pauses, st)
      : { start: 0, end: Infinity }
    const cExt = ct ? trackExtent(o.manifest.pauses, ct) : null

    const scale = Math.min(1, (o.maxHeight ?? 1080) / screen.height)
    const width = even(screen.width * scale)
    const height = even(screen.height * scale)

    const format =
      o.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
    const videoCandidates: VideoCodec[] =
      o.format === 'mp4' ? ['avc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1']
    const videoCodec = await getFirstEncodableVideoCodec(videoCandidates, {
      width,
      height,
    })
    if (!videoCodec)
      throw new ExportError("This browser can't encode video in that format.")

    const durationMs = editedDuration(o.edit)
    const total = Math.max(1, Math.floor((durationMs / 1000) * fps))

    const target = new BufferTarget()
    output = new Output({ format, target })
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ExportError("Couldn't create a drawing surface.")
    const videoSource = new CanvasSource(canvas, {
      codec: videoCodec,
      bitrate: videoBitrate(width, height, fps, quality),
    })
    output.addVideoTrack(videoSource, { frameRate: fps })

    // Audio: the camera file's mic, laid out along the edit list.
    let audioCodec: AudioCodec | null = null
    let audioBuffer: AudioBuffer | null = null
    let audioSource: AudioBufferSource | null = null
    if (o.camera && ct?.hasAudio && cExt && !audioSettings.mute) {
      audioBuffer = await buildEditedAudio(
        o.camera,
        o.edit,
        cExt.start,
        audioSettings,
      ).catch(() => null)
      if (audioBuffer) {
        audioCodec = await getFirstEncodableAudioCodec(
          o.format === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'],
          {
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: audioBuffer.sampleRate,
          },
        )
        if (audioCodec) {
          audioSource = new AudioBufferSource({
            codec: audioCodec,
            bitrate: audioBitrate(quality),
          })
          output.addAudioTrack(audioSource)
        }
      }
    }

    await output.start()
    if (audioSource && audioBuffer) await audioSource.add(audioBuffer)

    let lastScreen: VideoFrame | null = null
    for (let i = 0; i < total; i++) {
      check()
      const outMs = editedToOutput(o.edit, (i * 1000) / fps)
      const sf = await screen.getFrame(outMs - sExt.start)
      if (sf) lastScreen = sf
      const screenFrame = sf ?? lastScreen
      let cam: FrameSource | null = null
      if (camera && cExt && outMs >= cExt.start && outMs <= cExt.end) {
        const cf = await camera.getFrame(outMs - cExt.start)
        if (cf)
          cam = { source: cf, width: cf.displayWidth, height: cf.displayHeight }
      }
      const src: FrameSource | null = screenFrame
        ? {
            source: screenFrame,
            width: screenFrame.displayWidth,
            height: screenFrame.displayHeight,
          }
        : null
      renderFrame(ctx as never, { width, height }, src, cam, o.layout)
      await videoSource.add(i / fps, 1 / fps)
      if (i % 5 === 0) o.onProgress?.(i / total)
    }
    check()
    await output.finalize()
    o.onProgress?.(1)
    const buffer = target.buffer
    if (!buffer) throw new ExportError('The encoder produced no output.')
    return {
      blob: new Blob([buffer], { type: format.mimeType }),
      mime: format.mimeType,
      extension: format.fileExtension.replace(/^\./, ''),
      videoCodec,
      audioCodec,
      width,
      height,
      durationMs,
    }
  } catch (err) {
    if (output && output.state !== 'finalized')
      await output.cancel().catch(() => {})
    throw err
  } finally {
    screen.dispose()
    camera?.dispose()
  }
}

/** Decode the camera file's audio and lay it out along the edit list (silence where absent). */
async function buildEditedAudio(
  file: Blob,
  edit: EditList,
  cameraStartMs: number,
  settings: AudioSettings,
): Promise<AudioBuffer | null> {
  const ctx = new AudioContext()
  try {
    const src = await ctx.decodeAudioData(await file.arrayBuffer())
    const sr = src.sampleRate
    const length = Math.max(1, Math.round((editedDuration(edit) / 1000) * sr))
    const out = new AudioBuffer({
      length,
      sampleRate: sr,
      numberOfChannels: src.numberOfChannels,
    })
    let cursor = 0
    for (const r of edit.ranges) {
      const from = Math.round(((r.startMs - cameraStartMs) / 1000) * sr)
      const len = Math.round(((r.endMs - r.startMs) / 1000) * sr)
      for (let c = 0; c < src.numberOfChannels; c++) {
        const data = src.getChannelData(c)
        const dst = out.getChannelData(c)
        const s0 = Math.max(0, from)
        const s1 = Math.min(data.length, from + len)
        if (s1 > s0) dst.set(data.subarray(s0, s1), cursor + (s0 - from))
      }
      cursor += len
    }
    // Gain: optional peak normalisation, then the user's volume.
    let peak = 0
    for (let c = 0; c < out.numberOfChannels; c++) {
      const d = out.getChannelData(c)
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
    }
    const gain = (settings.normalise ? normaliseGain(peak) : 1) * settings.gain
    if (gain !== 1) {
      for (let c = 0; c < out.numberOfChannels; c++) {
        const d = out.getChannelData(c)
        for (let i = 0; i < d.length; i++)
          d[i] = Math.max(-1, Math.min(1, d[i] * gain))
      }
    }
    return out
  } finally {
    void ctx.close()
  }
}
