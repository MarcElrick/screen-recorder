import { withTimeout } from '../recording/timeout'
import type { StreamReply, StreamRequest } from './opfs-stream.worker'

/** Where recorded chunks go. OPFS in production, memory as a fallback/in tests. */
export interface ChunkSink {
  write(chunk: Blob): Promise<void>
  /** Finish writing and return the complete file. */
  close(): Promise<Blob>
}

export class MemorySink implements ChunkSink {
  private chunks: Blob[] = []
  constructor(private readonly type = 'video/webm') {}
  async write(chunk: Blob): Promise<void> {
    this.chunks.push(chunk)
  }
  async close(): Promise<Blob> {
    return new Blob(this.chunks, { type: this.type })
  }
}

/**
 * Streams chunks into an OPFS file from a worker (sync access handle), so the
 * file grows during recording and survives a crash.
 */
export class StreamingSink implements ChunkSink {
  private pending: ((r: StreamReply) => void) | null = null

  private constructor(
    private readonly worker: Worker,
    private readonly dir: string,
    private readonly name: string,
  ) {
    worker.onmessage = (e: MessageEvent<StreamReply>) => {
      const p = this.pending
      this.pending = null
      p?.(e.data)
    }
    worker.onerror = (e) => {
      const p = this.pending
      this.pending = null
      p?.({ type: 'error', error: e.message || 'Storage worker failed' })
    }
  }

  private send(m: StreamRequest, transfer: Transferable[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending = (r) =>
        r.type === 'ok' ? resolve() : reject(new Error(r.error))
      this.worker.postMessage(m, transfer)
    })
  }

  static async create(dir: string, name: string): Promise<StreamingSink> {
    const worker = new Worker(
      new URL('./opfs-stream.worker.ts', import.meta.url),
      { type: 'module' },
    )
    const sink = new StreamingSink(worker, dir, name)
    try {
      await sink.send({ type: 'open', dir, name })
    } catch (err) {
      worker.terminate()
      throw err
    }
    return sink
  }

  async write(chunk: Blob): Promise<void> {
    const data = await chunk.arrayBuffer()
    await this.send({ type: 'write', data }, [data])
  }

  async close(): Promise<Blob> {
    try {
      await this.send({ type: 'close' })
    } finally {
      this.worker.terminate()
    }
    const root = await navigator.storage.getDirectory()
    const d = await root.getDirectoryHandle(this.dir)
    return (await d.getFileHandle(this.name)).getFile()
  }
}

/** `?storage=memory` records in memory and writes on stop (for testing that path). */
function forceMemory(): boolean {
  return (
    typeof location !== 'undefined' &&
    /[?&]storage=memory\b/.test(location.search)
  )
}

/** OPFS can be read and written in some way (read access is enough for Compose). */
export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
}

/**
 * Workers can write OPFS files directly with sync access handles. That API only
 * exists inside workers, so it can't be feature-detected from the main thread;
 * every browser with OPFS and workers has it.
 */
function syncHandleSupported(): boolean {
  return typeof Worker !== 'undefined' && opfsSupported()
}

/**
 * Whether chunks can be streamed to OPFS while recording (crash-safe).
 * Otherwise takes are held in memory and written once on stop (`persistFile`).
 */
export function canStreamToOpfs(): boolean {
  return opfsSupported() && !forceMemory() && syncHandleSupported()
}

function writeViaWorker(dir: string, name: string, data: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined')
      return reject(new Error('Workers unavailable'))
    const w = new Worker(new URL('./opfs-writer.worker.ts', import.meta.url), {
      type: 'module',
    })
    w.onmessage = (e: MessageEvent<{ ok: boolean; error?: string }>) => {
      w.terminate()
      if (e.data.ok) resolve()
      else reject(new Error(e.data.error ?? 'Write failed'))
    }
    w.onerror = (e) => {
      w.terminate()
      reject(new Error(e.message || 'Write failed'))
    }
    w.postMessage({ dir, name, data })
  })
}

/** Write a whole file to OPFS (a worker with a sync handle where available, else createWritable). */
export async function persistFile(
  dir: string,
  name: string,
  data: Blob,
): Promise<void> {
  if (!opfsSupported()) throw new Error('Browser storage is not available')
  if (syncHandleSupported()) {
    await withTimeout(
      writeViaWorker(dir, name, data),
      60_000,
      'Writing to storage',
    )
    return
  }
  const root = await navigator.storage.getDirectory()
  const d = await root.getDirectoryHandle(dir, { create: true })
  const w = await (
    await d.getFileHandle(name, { create: true })
  ).createWritable()
  await w.write(data)
  await w.close()
}

/**
 * Writes to `primary`; if it ever fails or stalls, carries on in memory so the
 * take is still saved (without crash-safety) and reports it via `onDegrade`.
 */
export class ResilientSink implements ChunkSink {
  private memory = new MemorySink()
  private degraded = false
  private primaryWrites = 0

  constructor(
    private readonly primary: ChunkSink,
    private readonly onDegrade?: (err: unknown) => void,
    private readonly timeoutMs = 10_000,
  ) {}

  async write(chunk: Blob): Promise<void> {
    if (!this.degraded) {
      try {
        await withTimeout(
          this.primary.write(chunk),
          this.timeoutMs,
          'Writing to storage',
        )
        this.primaryWrites++
        return
      } catch (err) {
        this.degraded = true
        this.onDegrade?.(err)
      }
    }
    await this.memory.write(chunk)
  }

  async close(): Promise<Blob> {
    if (this.degraded && this.primaryWrites === 0) return this.memory.close()
    try {
      const blob = await withTimeout(
        this.primary.close(),
        this.timeoutMs,
        'Finishing the file',
      )
      if (!this.degraded) return blob
      // Part of the take is in storage and the rest in memory: join them.
      return new Blob([blob, await this.memory.close()], { type: blob.type })
    } catch (err) {
      this.onDegrade?.(err)
      return this.memory.close()
    }
  }
}

export type SinkFactory = (
  dir: string,
  name: string,
  onDegrade?: (err: unknown) => void,
) => Promise<ChunkSink>

/** OPFS when available, otherwise memory (with `fellBack` reported by caller). */
export const defaultSinkFactory: SinkFactory = async (dir, name, onDegrade) => {
  if (canStreamToOpfs()) {
    try {
      return new ResilientSink(
        await withTimeout(
          StreamingSink.create(dir, name),
          5000,
          'Opening storage',
        ),
        onDegrade,
      )
    } catch {
      /* fall through to memory */
    }
  }
  return new MemorySink()
}

export async function writeJson(
  dir: string,
  name: string,
  data: unknown,
): Promise<void> {
  await persistFile(
    dir,
    name,
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
}
