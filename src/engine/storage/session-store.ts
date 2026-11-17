import type { SessionManifest } from '../session/manifest'
import { opfsSupported, writeJson } from './sink'

export interface LoadedSession {
  manifest: SessionManifest
  screen: Blob | null
  camera: Blob | null
}

/**
 * Takes kept in memory for browsers without usable OPFS (Firefox). They last
 * until the page is reloaded.
 */
const memory = new Map<
  string,
  {
    manifest: SessionManifest
    screen: Blob | null
    camera: Blob | null
    json: Map<string, unknown>
  }
>()

export function rememberSession(
  manifest: SessionManifest,
  files: { kind: 'screen' | 'camera'; blob: Blob }[],
): void {
  memory.set(manifest.id, {
    manifest,
    screen: files.find((f) => f.kind === 'screen')?.blob ?? null,
    camera: files.find((f) => f.kind === 'camera')?.blob ?? null,
    json: new Map(),
  })
}

async function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

/** Saved takes (directories holding a session.json), newest first. */
export async function listSessions(): Promise<
  { id: string; createdAt: string; durationMs: number }[]
> {
  const out: { id: string; createdAt: string; durationMs: number }[] = []
  for (const { manifest: m } of memory.values()) {
    out.push({ id: m.id, createdAt: m.createdAt, durationMs: m.durationMs })
  }
  if (!opfsSupported())
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const r = (await root()) as unknown as {
    entries(): AsyncIterable<[string, FileSystemHandle]>
  }
  for await (const [name, handle] of r.entries()) {
    if (handle.kind !== 'directory') continue
    try {
      const f = await (handle as FileSystemDirectoryHandle).getFileHandle(
        'session.json',
      )
      const m = JSON.parse(await (await f.getFile()).text()) as SessionManifest
      out.push({
        id: m.id ?? name,
        createdAt: m.createdAt,
        durationMs: m.durationMs,
      })
    } catch {
      /* not a session */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export class SessionLoadError extends Error {}

export async function loadSession(id: string): Promise<LoadedSession> {
  const mem = memory.get(id)
  if (mem) {
    if (!mem.screen)
      throw new SessionLoadError('This take has no screen recording.')
    return { manifest: mem.manifest, screen: mem.screen, camera: mem.camera }
  }
  if (!opfsSupported())
    throw new SessionLoadError(
      'Local storage is not available in this browser.',
    )
  let dir: FileSystemDirectoryHandle
  try {
    dir = await (await root()).getDirectoryHandle(id)
  } catch {
    throw new SessionLoadError('That take could not be found.')
  }
  let manifest: SessionManifest
  try {
    manifest = JSON.parse(
      await (await (await dir.getFileHandle('session.json')).getFile()).text(),
    ) as SessionManifest
  } catch {
    throw new SessionLoadError('The take has no readable session.json.')
  }
  if (!Array.isArray(manifest.tracks) || !Array.isArray(manifest.pauses)) {
    throw new SessionLoadError('The take’s session.json is not valid.')
  }
  const read = async (kind: 'screen' | 'camera'): Promise<Blob | null> => {
    const t = manifest.tracks.find((x) => x.kind === kind)
    if (!t) return null
    try {
      return await (await dir.getFileHandle(t.file)).getFile()
    } catch {
      throw new SessionLoadError(`The ${kind} recording file is missing.`)
    }
  }
  const screen = await read('screen')
  if (!screen) throw new SessionLoadError('This take has no screen recording.')
  return { manifest, screen, camera: await read('camera') }
}

export function saveManifest(id: string, manifest: unknown): Promise<void> {
  const mem = memory.get(id)
  if (mem) mem.manifest = manifest as SessionManifest
  return writeJson(id, 'session.json', manifest)
}

export async function readCachedJson<T>(
  id: string,
  name: string,
): Promise<T | null> {
  const mem = memory.get(id)
  if (mem) return (mem.json.get(name) as T | undefined) ?? null
  try {
    const dir = await (await root()).getDirectoryHandle(id)
    return JSON.parse(
      await (await (await dir.getFileHandle(name)).getFile()).text(),
    ) as T
  } catch {
    return null
  }
}

export function writeCachedJson(
  id: string,
  name: string,
  data: unknown,
): Promise<void> {
  const mem = memory.get(id)
  if (mem) {
    mem.json.set(name, data)
    return Promise.resolve()
  }
  return writeJson(id, name, data)
}
