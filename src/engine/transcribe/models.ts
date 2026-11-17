import type { ModelId } from './types'

export interface ModelInfo {
  id: ModelId
  label: string
  /** Hugging Face repo with word-timestamp (alignment head) support. */
  repo: string
  approxMb: number
  hint: string
  /** Too slow to be practical without WebGPU. */
  needsGpu?: boolean
  /** Weights precision on WebGPU (large encoders must be fp16 to fit). */
  webgpuDtype?: Record<string, string>
}

export const MODELS: Record<ModelId, ModelInfo> = {
  tiny: {
    id: 'tiny',
    label: 'Tiny',
    repo: 'onnx-community/whisper-tiny_timestamped',
    approxMb: 40,
    hint: 'Fastest, rougher on accents and jargon',
  },
  base: {
    id: 'base',
    label: 'Base',
    repo: 'onnx-community/whisper-base_timestamped',
    approxMb: 110,
    hint: 'Best balance for presentations',
  },
  small: {
    id: 'small',
    label: 'Small',
    repo: 'onnx-community/whisper-small_timestamped',
    approxMb: 350,
    hint: 'More accurate, slow without a GPU',
  },
  large: {
    id: 'large',
    label: 'Large (turbo)',
    repo: 'onnx-community/whisper-large-v3-turbo_timestamped',
    approxMb: 1500,
    hint: 'Best accuracy and timing. Needs a good GPU and a big one-time download',
    needsGpu: true,
    webgpuDtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
  },
}

export const DEFAULT_MODEL: ModelId = 'base'

export type ModelStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'error'

export interface ModelState {
  model: ModelId
  status: ModelStatus
  /** 0..1 across all files while downloading. */
  progress: number
  /** The files were already in the browser cache. */
  cached: boolean
  device: 'webgpu' | 'wasm' | null
  error: string
}

/** Messages between the app and the Whisper worker. */
export type ToWhisper =
  | {
      type: 'load'
      repo: string
      device?: 'webgpu' | 'wasm'
      dtype?: Record<string, string>
    }
  | { type: 'transcribe'; audio: Float32Array; language?: string }

export type FromWhisper =
  | { type: 'progress'; loaded: number; total: number; cached: boolean }
  | { type: 'loading' }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | {
      type: 'result'
      chunks: { text: string; timestamp: [number | null, number | null] }[]
      language: string
    }
  | { type: 'error'; message: string }

/** Combine per-file download progress into one fraction. */
export function aggregateProgress(
  files: Map<string, { loaded: number; total: number }>,
): { loaded: number; total: number; fraction: number } {
  let loaded = 0
  let total = 0
  for (const f of files.values()) {
    loaded += f.loaded
    total += f.total
  }
  return {
    loaded,
    total,
    fraction: total > 0 ? Math.min(1, loaded / total) : 0,
  }
}
