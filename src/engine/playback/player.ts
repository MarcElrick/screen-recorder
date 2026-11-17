import {
  editedDuration,
  editedToOutput,
  outputToEditedSnap,
  type EditList,
} from '../timeline/editlist'
import { trackExtent } from '../timeline/time'
import type { SessionManifest } from '../session/manifest'
import {
  renderFrame,
  type FrameSource,
  type Layout,
} from '../compositing/render'
import type { DecodedVideo } from './decoded-video'
import type { RemoteRenderer } from '../compositing/remote-renderer'
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
  private lastSeek = new WeakMap<HTMLVideoElement, number>()
  private frames: { screen: DecodedVideo | null; camera: DecodedVideo | null } =
    {
      screen: null,
      camera: null,
    }
  private remote: RemoteRenderer | null = null
  private lastOutputMs = 0
  private lastCameraActive = false
  layout: Layout
  duration: number
  private readonly screenExtent: { start: number; end: number }
  private readonly cameraExtent: { start: number; end: number } | null

  constructor(
    private readonly manifest: SessionManifest,
    private edit: EditList,
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

  /** Swap the edit list, keeping the playhead on the same source moment. */
  setEdit(edit: EditList): void {
    const output = editedToOutput(this.edit, this._playhead)
    this.edit = edit
    this.duration = editedDuration(edit)
    this._playhead = Math.min(outputToEditedSnap(edit, output), this.duration)
    this.emit()
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
      try {
        this.tick(now)
      } catch (err) {
        // A render error must not stop the clock.
        console.error('Compose tick failed', err)
      }
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.screen.pause()
    this.camera?.pause()
    this.frames.screen?.dispose()
    this.frames.camera?.dispose()
    this.frames = { screen: null, camera: null }
    this.remote?.dispose()
    this.remote = null
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
      seeking: video.seeking,
      sinceSeekMs: performance.now() - (this.lastSeek.get(video) ?? -Infinity),
    })
    if (plan.seekTo !== null) {
      video.currentTime = plan.seekTo
      this.lastSeek.set(video, performance.now())
    }
    if (plan.shouldPlay && video.paused) void video.play().catch(() => {})
    if (!plan.shouldPlay && !video.paused) video.pause()
    return plan.active
  }

  private syncAndDraw(): void {
    const outputMs = editedToOutput(this.edit, this._playhead)
    this.lastOutputMs = outputMs
    // Frames come from WebCodecs when available; the screen element is then
    // idle, and the camera element only plays the audio.
    if (!this.frames.screen)
      this.align(this.screen, this.screenExtent, outputMs)
    let cameraActive = false
    if (this.camera && this.cameraExtent) {
      cameraActive = this.align(this.camera, this.cameraExtent, outputMs)
    }
    this.lastCameraActive = cameraActive
    this.draw(cameraActive)
  }

  /** Render in a worker: this class then only keeps time and audio. */
  setRemote(r: RemoteRenderer | null): void {
    this.remote = r
    if (r) this.screen.pause()
  }

  /** Use WebCodecs-decoded frames instead of the video elements for drawing. */
  setFrameSources(
    screen: DecodedVideo | null,
    camera: DecodedVideo | null,
  ): void {
    this.frames.screen?.dispose()
    this.frames.camera?.dispose()
    this.frames = { screen, camera }
    if (screen && !this._playing) this.screen.pause()
  }

  /** Redraw the current frame (call after layout changes). */
  draw(cameraActive = this.lastCameraActive): void {
    if (this.remote) {
      this.remote.draw({
        screenMs: this.lastOutputMs - this.screenExtent.start,
        cameraMs:
          cameraActive && this.cameraExtent
            ? this.lastOutputMs - this.cameraExtent.start
            : null,
        // Plain copy: the layout may be a reactive proxy, which can't be cloned.
        layout: {
          shape: this.layout.shape,
          placement: { ...this.layout.placement },
        },
      })
      return
    }
    let screenSrc: FrameSource
    const df = this.frames.screen
    if (df) {
      const f = df.frameAt(this.lastOutputMs - this.screenExtent.start)
      if (!f) return // still decoding: keep the previous frame on the canvas
      screenSrc = { source: f, width: f.displayWidth, height: f.displayHeight }
    } else {
      const w = this.screen.videoWidth
      const h = this.screen.videoHeight
      if (!w || !h) return
      screenSrc = { source: this.screen, width: w, height: h }
    }
    const w = screenSrc.width
    const h = screenSrc.height
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    let cam: FrameSource | null = null
    if (this.camera && cameraActive && this.cameraExtent) {
      const cf = this.frames.camera?.frameAt(
        this.lastOutputMs - this.cameraExtent.start,
      )
      if (cf)
        cam = { source: cf, width: cf.displayWidth, height: cf.displayHeight }
      else if (!this.frames.camera && this.camera.videoWidth > 0)
        cam = {
          source: this.camera,
          width: this.camera.videoWidth,
          height: this.camera.videoHeight,
        }
    }
    renderFrame(
      ctx as never,
      { width: w, height: h },
      screenSrc,
      cam,
      this.layout,
    )
  }
}
