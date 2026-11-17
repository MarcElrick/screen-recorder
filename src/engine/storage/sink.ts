import { withTimeout } from '../recording/timeout'

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

export class OpfsSink implements ChunkSink {
  private constructor(
    private readonly handle: FileSystemFileHandle,
    private readonly writable: FileSystemWritableFileStream,
  ) {}

  static async create(dir: string, name: string): Promise<OpfsSink> {
    const root = await navigator.storage.getDirectory()
    const d = await root.getDirectoryHandle(dir, { create: true })
    const handle = await d.getFileHandle(name, { create: true })
    return new OpfsSink(handle, await handle.createWritable())
  }

  async write(chunk: Blob): Promise<void> {
    await this.writable.write(chunk)
  }

  async close(): Promise<Blob> {
    await this.writable.close()
    return this.handle.getFile()
  }
}

function isFirefox(): boolean {
  return (
    typeof navigator !== 'undefined' && /firefox\//i.test(navigator.userAgent)
  )
}

export function opfsSupported(): boolean {
  // Firefox's OPFS writable streams are not reliable enough to depend on yet:
  // keep chunks in memory there instead of risking a take that never saves.
  if (isFirefox()) return false
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage?.getDirectory &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createWritable' in FileSystemFileHandle.prototype
  )
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
  if (opfsSupported()) {
    try {
      return new ResilientSink(
        await withTimeout(OpfsSink.create(dir, name), 5000, 'Opening storage'),
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
  if (!opfsSupported()) return
  const root = await navigator.storage.getDirectory()
  const d = await root.getDirectoryHandle(dir, { create: true })
  const w = await (
    await d.getFileHandle(name, { create: true })
  ).createWritable()
  await w.write(JSON.stringify(data, null, 2))
  await w.close()
}
