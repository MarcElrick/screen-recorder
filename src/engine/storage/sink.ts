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

export function opfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage?.getDirectory &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createWritable' in FileSystemFileHandle.prototype
  )
}

export type SinkFactory = (dir: string, name: string) => Promise<ChunkSink>

/** OPFS when available, otherwise memory (with `fellBack` reported by caller). */
export const defaultSinkFactory: SinkFactory = async (dir, name) => {
  if (opfsSupported()) {
    try {
      return await OpfsSink.create(dir, name)
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
