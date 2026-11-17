import type { Interval } from '../recording/clock'
import { webmDurationMs, fixWebm } from '../recording/webm-fix'
import type { TrackResult } from '../recording/track-recorder'
import { deleteSession } from '../storage/session-store'
import { opfsSupported, persistFile } from '../storage/sink'
import { JOURNAL_FILE, type Journal } from './journal'
import { buildManifest, type SessionManifest } from './manifest'

export interface UnfinishedTake {
  id: string
  startedAt: string
  sizeBytes: number
}

async function readJournal(
  dir: FileSystemDirectoryHandle,
): Promise<Journal | null> {
  try {
    const f = await (await dir.getFileHandle(JOURNAL_FILE)).getFile()
    const j = JSON.parse(await f.text()) as Journal
    return j?.version === 1 && Array.isArray(j.tracks) ? j : null
  } catch {
    return null
  }
}

async function hasFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

/** Takes whose recording never finished (a journal but no session.json). */
export async function findUnfinished(): Promise<UnfinishedTake[]> {
  if (!opfsSupported()) return []
  const out: UnfinishedTake[] = []
  const root = (await navigator.storage.getDirectory()) as unknown as {
    entries(): AsyncIterable<[string, FileSystemHandle]>
  }
  for await (const [name, handle] of root.entries()) {
    if (handle.kind !== 'directory') continue
    const dir = handle as FileSystemDirectoryHandle
    if (await hasFile(dir, 'session.json')) continue
    const j = await readJournal(dir)
    if (!j) continue
    let size = 0
    for (const t of j.tracks) {
      try {
        size += (await (await dir.getFileHandle(t.file)).getFile()).size
      } catch {
        /* file missing */
      }
    }
    if (size > 0)
      out.push({ id: j.id || name, startedAt: j.startedAt, sizeBytes: size })
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** Raw clock offset where a track ends, given its media length and the pauses it spans. */
export function trackEndOffset(
  startMs: number,
  mediaMs: number,
  pauses: Interval[],
): number {
  let end = startMs + mediaMs
  for (const p of [...pauses].sort((a, b) => a.from - b.from)) {
    if (p.from >= startMs && p.from < end) end += p.to - p.from
  }
  return end
}

/** Rebuild session.json for an interrupted take from its journal and media files. */
export async function recoverTake(id: string): Promise<SessionManifest> {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(id)
  const j = await readJournal(dir)
  if (!j) throw new Error('Nothing to recover for this take.')

  const tracks: TrackResult[] = []
  for (const t of j.tracks) {
    let file: File
    try {
      file = await (await dir.getFileHandle(t.file)).getFile()
    } catch {
      continue
    }
    if (file.size === 0) continue
    const mediaMs = await webmDurationMs(file)
    if (!mediaMs) continue
    const fixed = await fixWebm(file)
    if (fixed !== file) await persistFile(id, t.file, fixed)
    tracks.push({
      kind: t.kind,
      file: t.file,
      mime: t.mime,
      blob: fixed,
      startOffsetMs: t.startOffsetMs,
      endOffsetMs: trackEndOffset(t.startOffsetMs, mediaMs, j.pauses),
      endedEarly: false,
      hasAudio: t.hasAudio,
    })
  }
  if (!tracks.some((t) => t.kind === 'screen'))
    throw new Error(
      'The screen recording was empty, so there is nothing to recover.',
    )

  const rawEnd = Math.max(...tracks.map((t) => t.endOffsetMs))
  const pauses = j.pauses.filter((p) => p.to <= rawEnd)
  const paused = pauses.reduce((n, p) => n + (p.to - p.from), 0)
  const manifest = {
    ...buildManifest({
      id,
      createdAt: new Date(j.startedAt),
      durationMs: rawEnd - paused,
      pauses,
      tracks,
      bubble: j.bubble as SessionManifest['bubble'],
    }),
    name: `Recovered ${new Date(j.startedAt).toLocaleString()}`,
  }
  await persistFile(
    id,
    'session.json',
    new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
  )
  try {
    await dir.removeEntry(JOURNAL_FILE)
  } catch {
    /* already gone */
  }
  return manifest
}

export const discardUnfinished = deleteSession
