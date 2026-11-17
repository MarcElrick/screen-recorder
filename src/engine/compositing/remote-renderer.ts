import type { DrawState, FromWorker, ToWorker } from './compose.worker'

/** Handle to the off-main-thread Compose renderer (see compose.worker.ts). */
export class RemoteRenderer {
  private constructor(
    private readonly worker: Worker,
    readonly width: number,
    readonly height: number,
    readonly hasCamera: boolean,
  ) {}

  static supported(canvas: HTMLCanvasElement): boolean {
    return (
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof VideoDecoder !== 'undefined' &&
      'transferControlToOffscreen' in canvas
    )
  }

  /**
   * Starts the worker and checks it can decode these files, without touching
   * the canvas. Resolves null if anything isn't supported, so the caller can
   * fall back while the canvas is still usable.
   */
  static create(
    screen: Blob,
    camera: Blob | null,
    timeoutMs = 8000,
  ): Promise<RemoteRenderer | null> {
    return new Promise((resolve) => {
      let worker: Worker
      try {
        worker = new Worker(new URL('./compose.worker.ts', import.meta.url), {
          type: 'module',
        })
      } catch {
        resolve(null)
        return
      }
      const fail = (): void => {
        clearTimeout(timer)
        worker.terminate()
        resolve(null)
      }
      const timer = setTimeout(fail, timeoutMs)
      worker.onerror = fail
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        clearTimeout(timer)
        const m = e.data
        if (m.type === 'ready') {
          worker.onerror = null
          worker.onmessage = null
          resolve(new RemoteRenderer(worker, m.width, m.height, m.camera))
        } else fail()
      }
      const msg: ToWorker = { type: 'open', screen, camera }
      worker.postMessage(msg)
    })
  }

  /** Hand the canvas over. After this the main thread can't draw on it. */
  attachCanvas(canvas: HTMLCanvasElement): void {
    const off = canvas.transferControlToOffscreen()
    const msg: ToWorker = { type: 'canvas', canvas: off }
    this.worker.postMessage(msg, [off])
  }

  draw(state: DrawState): void {
    const msg: ToWorker = { type: 'draw', ...state }
    this.worker.postMessage(msg)
  }

  dispose(): void {
    const msg: ToWorker = { type: 'dispose' }
    this.worker.postMessage(msg)
    this.worker.terminate()
  }
}
