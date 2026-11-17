import {
  DEFAULT_MODEL,
  MODELS,
  type FromWhisper,
  type ModelState,
  type ToWhisper,
} from './models'
import type { ModelId } from './types'
import { wordsFromChunks } from './state'
import type { Word } from './types'

type Listener = (s: ModelState) => void

/**
 * Test hook: end-to-end tests set `globalThis.__speechStub` so the real model
 * isn't downloaded. Ignored in normal use.
 */
interface SpeechStub {
  chunks: { text: string; timestamp: [number | null, number | null] }[]
}
const stubbed = (): SpeechStub | undefined =>
  (globalThis as { __speechStub?: SpeechStub }).__speechStub

/**
 * Owns the Whisper worker. The model is fetched into the browser cache early
 * (`prefetch`) so Annotate opens with it ready; the worker is kept so the
 * loaded model is reused.
 */
export class SpeechModel {
  private worker: Worker | null = null
  private listeners = new Set<Listener>()
  private loading: Promise<void> | null = null
  private pending: {
    resolve: (r: Extract<FromWhisper, { type: 'result' }>) => void
    reject: (e: Error) => void
  } | null = null
  state: ModelState = {
    model: DEFAULT_MODEL,
    status: 'idle',
    progress: 0,
    cached: false,
    device: null,
    error: '',
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<ModelState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
  }

  static supported(): boolean {
    return typeof Worker !== 'undefined' && typeof AudioContext !== 'undefined'
  }

  /** Is this model's data already in the browser cache? (No download.) */
  static async isCached(model: ModelId): Promise<boolean> {
    try {
      if (typeof caches === 'undefined') return false
      const cache = await caches.open('transformers-cache')
      const repo = MODELS[model].repo
      const keys = await cache.keys()
      return keys.some((k) => k.url.includes(repo) && k.url.endsWith('.onnx'))
    } catch {
      return false
    }
  }

  /** Ask the browser not to evict the downloaded model. */
  static async keepStorage(): Promise<void> {
    try {
      await navigator.storage?.persist?.()
    } catch {
      /* best effort */
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
      type: 'module',
    })
    w.onmessage = (e: MessageEvent<FromWhisper>) => this.onMessage(e.data)
    w.onerror = (e) => this.fail(e.message || 'The speech worker crashed.')
    this.worker = w
    return w
  }

  private onMessage(m: FromWhisper): void {
    if (m.type === 'progress') {
      this.set({
        status: 'downloading',
        cached: m.cached,
        progress: m.total > 0 ? Math.min(1, m.loaded / m.total) : 0,
      })
    } else if (m.type === 'loading') {
      this.set({ status: 'loading' })
    } else if (m.type === 'ready') {
      this.set({ status: 'ready', progress: 1, device: m.device })
      this.loadResolve?.()
    } else if (m.type === 'result') {
      this.pending?.resolve(m)
      this.pending = null
    } else if (m.type === 'error') {
      this.fail(m.message)
    }
  }
  private loadResolve: (() => void) | null = null
  private loadReject: ((e: Error) => void) | null = null

  private fail(message: string): void {
    this.set({ status: 'error', error: message })
    this.loadReject?.(new Error(message))
    this.pending?.reject(new Error(message))
    this.pending = null
    this.loading = null
    this.worker?.terminate()
    this.worker = null
  }

  /**
   * Download (or read from cache) and initialise the model. Safe to call
   * repeatedly; resolves when ready.
   */
  load(model: ModelId = this.state.model): Promise<void> {
    if (this.loading && this.state.model === model) return this.loading
    if (this.state.status === 'ready' && this.state.model === model)
      return Promise.resolve()
    if (this.state.model !== model) this.dispose()
    if (stubbed()) {
      this.set({ model, status: 'ready', progress: 1, device: 'wasm' })
      return Promise.resolve()
    }
    this.set({ model, status: 'downloading', progress: 0, error: '' })
    void SpeechModel.keepStorage()
    const worker = this.ensureWorker()
    this.loading = new Promise<void>((resolve, reject) => {
      this.loadResolve = resolve
      this.loadReject = reject
    })
    this.loading.catch(() => {})
    const msg: ToWhisper = {
      type: 'load',
      repo: MODELS[model].repo,
      dtype: MODELS[model].webgpuDtype,
    }
    worker.postMessage(msg)
    return this.loading
  }

  /** Transcribe 16 kHz mono audio. Words are in *file* time (ms), offset by the caller. */
  async transcribe(
    audio: Float32Array,
    opts: { offsetMs: number; totalMs: number; language?: string },
  ): Promise<{ words: Word[]; language: string }> {
    await this.load()
    const stub = stubbed()
    if (stub)
      return {
        words: wordsFromChunks(stub.chunks, opts.offsetMs, opts.totalMs),
        language: 'english',
      }
    const worker = this.ensureWorker()
    const result = await new Promise<Extract<FromWhisper, { type: 'result' }>>(
      (resolve, reject) => {
        this.pending = { resolve, reject }
        const msg: ToWhisper = {
          type: 'transcribe',
          audio,
          language: opts.language,
        }
        worker.postMessage(msg, [audio.buffer])
      },
    )
    return {
      words: wordsFromChunks(result.chunks, opts.offsetMs, opts.totalMs),
      language: result.language,
    }
  }

  /** Stop a running transcription. The model files stay cached. */
  cancel(): void {
    this.pending?.reject(new Error('cancelled'))
    this.pending = null
    this.dispose()
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.loading = null
    this.set({ status: 'idle', progress: 0 })
  }
}

/** The one shared instance (the app prefetches into it; Annotate reuses it). */
export const speech = new SpeechModel()
