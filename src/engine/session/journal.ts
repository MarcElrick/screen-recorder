import type { Interval } from '../recording/clock'
import { opfsSupported, persistFile } from '../storage/sink'

/**
 * A small file written next to the media while recording. If the tab dies
 * before the take is finalised, it holds what's needed to rebuild the manifest
 * (track start offsets and pauses) so the take can be recovered.
 */
export interface JournalTrack {
  kind: 'screen' | 'camera'
  file: string
  mime: string
  startOffsetMs: number
  hasAudio: boolean
}

export interface Journal {
  version: 1
  id: string
  startedAt: string
  tracks: JournalTrack[]
  pauses: Interval[]
  /** Raw clock offset of a pause that was still open. */
  openPauseFrom: number | null
  bubble: unknown
}

export const JOURNAL_FILE = 'recording.json'

/** Serialises best-effort journal writes. */
export class JournalWriter {
  private chain: Promise<void> = Promise.resolve()
  constructor(private readonly dir: string) {}

  write(j: Journal): void {
    if (!opfsSupported()) return
    const blob = new Blob([JSON.stringify(j)], { type: 'application/json' })
    this.chain = this.chain
      .then(() => persistFile(this.dir, JOURNAL_FILE, blob))
      .catch(() => {})
  }

  /** Wait for pending writes, then delete the journal (the take is finalised). */
  async remove(): Promise<void> {
    await this.chain
    if (!opfsSupported()) return
    try {
      const root = await navigator.storage.getDirectory()
      const d = await root.getDirectoryHandle(this.dir)
      await d.removeEntry(JOURNAL_FILE)
    } catch {
      /* nothing to remove */
    }
  }
}
