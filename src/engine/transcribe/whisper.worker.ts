/// Whisper in a worker. The model files are cached by the browser's Cache API
/// (Transformers.js `useBrowserCache`), so they download once.
import { env, pipeline } from '@huggingface/transformers'
import type { FromWhisper, ToWhisper } from './models'

env.allowLocalModels = false
env.useBrowserCache = true

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToWhisper>) => void) | null
  postMessage(m: FromWhisper, transfer?: Transferable[]): void
}

type Recognizer = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{
  chunks?: { text: string; timestamp: [number | null, number | null] }[]
}>
let recognizer: Recognizer | null = null
let loadedRepo = ''

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (
      navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }
    ).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

async function load(repo: string, wanted?: 'webgpu' | 'wasm'): Promise<void> {
  if (recognizer && loadedRepo === repo) {
    scope.postMessage({ type: 'ready', device: lastDevice })
    return
  }
  const device = wanted ?? ((await hasWebGpu()) ? 'webgpu' : 'wasm')
  const files = new Map<string, { loaded: number; total: number }>()
  let downloaded = false
  const report = (): void => {
    let loaded = 0
    let total = 0
    for (const f of files.values()) {
      loaded += f.loaded
      total += f.total
    }
    scope.postMessage({ type: 'progress', loaded, total, cached: !downloaded })
  }
  const dtype =
    device === 'webgpu'
      ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
      : 'q8'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const make = pipeline as any
  recognizer = await make('automatic-speech-recognition', repo, {
    device,
    dtype,
    progress_callback: (p: {
      status: string
      file?: string
      loaded?: number
      total?: number
    }) => {
      if (!p.file) return
      if (p.status === 'progress' && p.total) {
        // Bytes arriving over the network (not served from cache) mean a download.
        downloaded = true
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
        report()
      } else if (p.status === 'done' && files.has(p.file)) {
        const f = files.get(p.file)!
        files.set(p.file, { loaded: f.total, total: f.total })
        report()
      }
    },
  })
  loadedRepo = repo
  lastDevice = device
  scope.postMessage({ type: 'loading' })
  scope.postMessage({ type: 'ready', device })
}
let lastDevice: 'webgpu' | 'wasm' = 'wasm'

scope.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      await load(m.repo, m.device)
    } else if (m.type === 'transcribe') {
      if (!recognizer) throw new Error('The speech model is not loaded.')
      const out = await recognizer(m.audio, {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
        language: m.language || null,
        task: 'transcribe',
      })
      scope.postMessage({
        type: 'result',
        chunks: out.chunks ?? [],
        language: m.language || 'auto',
      })
    }
  } catch (err) {
    scope.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
