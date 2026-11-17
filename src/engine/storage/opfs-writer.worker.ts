/// Writes a whole file to OPFS from a worker. Firefox only allows this through
/// sync access handles, which exist only in workers.
export interface WriteRequest {
  dir: string
  name: string
  data: Blob
}
export type WriteReply = { ok: true } | { ok: false; error: string }

interface SyncHandle {
  truncate(n: number): void
  write(b: Uint8Array, o: { at: number }): number
  flush(): void
  close(): void
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WriteRequest>) => void) | null
  postMessage(m: WriteReply): void
}

ctx.onmessage = async (e) => {
  const { dir, name, data } = e.data
  try {
    const root = await navigator.storage.getDirectory()
    const d = await root.getDirectoryHandle(dir, { create: true })
    const file = await d.getFileHandle(name, { create: true })
    const handle = await (
      file as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }
    ).createSyncAccessHandle()
    try {
      handle.truncate(0)
      handle.write(new Uint8Array(await data.arrayBuffer()), { at: 0 })
      handle.flush()
    } finally {
      handle.close()
    }
    ctx.postMessage({ ok: true })
  } catch (err) {
    ctx.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
