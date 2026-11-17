/// Streams a recording to one OPFS file through a sync access handle. Unlike
/// createWritable (which only commits on close), data written here is in the
/// file as it arrives, so a crashed tab leaves a recoverable take behind.
interface SyncHandle {
  truncate(n: number): void
  write(b: Uint8Array, o: { at: number }): number
  flush(): void
  close(): void
}

export type StreamRequest =
  | { type: 'open'; dir: string; name: string }
  | { type: 'write'; data: ArrayBuffer }
  | { type: 'close' }
export type StreamReply = { type: 'ok' } | { type: 'error'; error: string }

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<StreamRequest>) => void) | null
  postMessage(m: StreamReply): void
}

let handle: SyncHandle | null = null
let pos = 0

ctx.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'open') {
      const root = await navigator.storage.getDirectory()
      const d = await root.getDirectoryHandle(m.dir, { create: true })
      const file = await d.getFileHandle(m.name, { create: true })
      handle = await (
        file as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }
      ).createSyncAccessHandle()
      handle.truncate(0)
      pos = 0
    } else if (m.type === 'write') {
      if (!handle) throw new Error('File is not open')
      const bytes = new Uint8Array(m.data)
      handle.write(bytes, { at: pos })
      pos += bytes.length
      handle.flush()
    } else if (m.type === 'close') {
      handle?.flush()
      handle?.close()
      handle = null
    }
    ctx.postMessage({ type: 'ok' })
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
