import type { SessionManifest } from '../session/manifest'
import { opfsSupported, writeJson } from './sink'

export interface LoadedSession {
  manifest: SessionManifest
  screen: Blob | null
  camera: Blob | null
}

async function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

/** Saved takes (directories holding a session.json), newest first. */
export async function listSessions(): Promise<
  { id: string; createdAt: string; durationMs: number }[]
> {
  if (!opfsSupported()) return []
  const out: { id: string; createdAt: string; durationMs: number }[] = []
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
  return writeJson(id, 'session.json', manifest)
}

export async function readCachedJson<T>(
  id: string,
  name: string,
): Promise<T | null> {
  try {
    const dir = await (await root()).getDirectoryHandle(id)
    return JSON.parse(
      await (await (await dir.getFileHandle(name)).getFile()).text(),
    ) as T
  } catch {
    return null
  }
}

export const writeCachedJson = writeJson
