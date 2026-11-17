/// The Compose preview renderer, running off the main thread. It owns the
/// decoders and the (transferred) canvas; the main thread only sends the
/// playhead and layout.
import { DecodedVideo } from '../playback/decoded-video'
import { renderFrame, type Layout } from './render'

export interface DrawState {
  /** Time inside the screen/camera tracks (ms), or null if the track is idle. */
  screenMs: number
  cameraMs: number | null
  layout: Layout
}

export type ToWorker =
  | { type: 'open'; screen: Blob; camera: Blob | null }
  | { type: 'canvas'; canvas: OffscreenCanvas }
  | ({ type: 'draw' } & DrawState)
  | { type: 'dispose' }

export type FromWorker =
  | { type: 'ready'; width: number; height: number; camera: boolean }
  | { type: 'unsupported' }

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
  postMessage(m: FromWorker): void
  close(): void
}

let screen: DecodedVideo | null = null
let camera: DecodedVideo | null = null
let canvas: OffscreenCanvas | null = null
let state: DrawState | null = null
let lastSig = ''
let timer: ReturnType<typeof setInterval> | undefined

function tick(): void {
  if (!canvas || !screen || !state) return
  const f = screen.frameAt(state.screenMs)
  if (!f) return // still decoding: keep the previous frame
  const cf =
    camera && state.cameraMs !== null ? camera.frameAt(state.cameraMs) : null
  const sig = `${f.timestamp}|${cf?.timestamp ?? '-'}|${JSON.stringify(state.layout)}`
  if (sig === lastSig) return
  lastSig = sig
  const w = f.displayWidth
  const h = f.displayHeight
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const c2d = canvas.getContext('2d')
  if (!c2d) return
  renderFrame(
    c2d as never,
    { width: w, height: h },
    { source: f, width: w, height: h },
    cf
      ? { source: cf, width: cf.displayWidth, height: cf.displayHeight }
      : null,
    state.layout,
  )
}

ctx.onmessage = async (e) => {
  const m = e.data
  if (m.type === 'open') {
    screen = await DecodedVideo.open(m.screen)
    camera = m.camera ? await DecodedVideo.open(m.camera) : null
    if (!screen || typeof OffscreenCanvas === 'undefined') {
      screen?.dispose()
      camera?.dispose()
      ctx.postMessage({ type: 'unsupported' })
      return
    }
    ctx.postMessage({
      type: 'ready',
      width: screen.width,
      height: screen.height,
      camera: camera !== null,
    })
  } else if (m.type === 'canvas') {
    canvas = m.canvas
    timer = setInterval(tick, 1000 / 60)
  } else if (m.type === 'draw') {
    state = m
  } else if (m.type === 'dispose') {
    if (timer) clearInterval(timer)
    screen?.dispose()
    camera?.dispose()
    ctx.close()
  }
}
