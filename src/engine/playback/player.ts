import {
  editedDuration,
  editedToOutput,
  type EditList,
} from '../timeline/editlist'
import { trackExtent } from '../timeline/time'
import type { SessionManifest } from '../session/manifest'
import { renderFrame, type Layout } from '../compositing/render'
import { planSync } from './sync'

type Listener = () => void

/**
 * Slaves a screen video and an optional camera video to one playhead (edited
 * time). The playhead advances from requestAnimationFrame; each frame the
 * media elements are re-aligned with `planSync` and drawn with `renderFrame`.
 */
export class SessionPlayer {
  private raf = 0
  private lastTick = 0
  private _playing = false
  private _playhead = 0
  private listeners = new Set<Listener>()
  layout: Layout
  readonly duration: number
  private readonly screenExtent: { start: number; end: number }
  private readonly cameraExtent: { start: number; end: number } | null

  constructor(
    private readonly manifest: SessionManifest,
    private readonly edit: EditList,
    readonly screen: HTMLVideoElement,
    readonly camera: HTMLVideoElement | null,
    private readonly canvas: HTMLCanvasElement,
    layout: Layout,
  ) {
    this.layout = layout
    this.duration = editedDuration(edit)
    const st = manifest.tracks.find((t) => t.kind === 'screen')
    const ct = manifest.tracks.find((t) => t.kind === 'camera')
    this.screenExtent = st
      ? trackExtent(manifest.pauses, st)
      : { start: 0, end: this.duration }
    this.cameraExtent = ct ? trackExtent(manifest.pauses, ct) : null
    screen.muted = true
    if (camera) camera.muted = false
  }

  get playing(): boolean {
    return this._playing
  }
  get playhead(): number {
    return this._playhead
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    this.listeners.forEach((l) => l())
  }

  start(): void {
    if (this.raf) return
    this.lastTick = performance.now()
    const loop = (now: number): void => {
      this.tick(now)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.screen.pause()
    this.camera?.pause()
    this.listeners.clear()
  }

  play(): void {
    if (this._playing) return
    if (this._playhead >= this.duration) this._playhead = 0
    this._playing = true
    this.emit()
  }
  pause(): void {
    if (!this._playing) return
    this._playing = false
    this.emit()
  }
  toggle(): void {
    if (this._playing) this.pause()
    else this.play()
  }
  seek(editedMs: number): void {
    this._playhead = Math.min(Math.max(editedMs, 0), this.duration)
    this.emit()
  }

  private tick(now: number): void {
    const dt = now - this.lastTick
    this.lastTick = now
    if (this._playing) {
      this._playhead += dt
      if (this._playhead >= this.duration) {
        this._playhead = this.duration
        this._playing = false
      }
      this.emit()
    }
    this.syncAndDraw()
  }

  private align(
    video: HTMLVideoElement,
    extent: { start: number; end: number },
    outputMs: number,
  ): boolean {
    const plan = planSync({
      outputMs,
      extent,
      currentTime: video.currentTime,
      playing: this._playing,
    })
    if (plan.seekTo !== null) video.currentTime = plan.seekTo
    if (plan.shouldPlay && video.paused) void video.play().catch(() => {})
    if (!plan.shouldPlay && !video.paused) video.pause()
    return plan.active
  }

  private syncAndDraw(): void {
    const outputMs = editedToOutput(this.edit, this._playhead)
    this.align(this.screen, this.screenExtent, outputMs)
    let cameraActive = false
    if (this.camera && this.cameraExtent) {
      cameraActive = this.align(this.camera, this.cameraExtent, outputMs)
    }
    this.draw(cameraActive)
  }

  /** Redraw the current frame (call after layout changes). */
  draw(cameraActive = true): void {
    const w = this.screen.videoWidth
    const h = this.screen.videoHeight
    if (!w || !h) return
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const cam =
      this.camera && cameraActive
        ? {
            source: this.camera,
            width: this.camera.videoWidth,
            height: this.camera.videoHeight,
          }
        : null
    renderFrame(
      ctx as never,
      { width: w, height: h },
      { source: this.screen, width: w, height: h },
      cam,
      this.layout,
    )
  }
}
