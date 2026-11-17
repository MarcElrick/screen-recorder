import type { Word } from './types'
import { wordText } from './cues'

export const FILLERS = [
  'um',
  'umm',
  'uh',
  'uhh',
  'er',
  'erm',
  'ah',
  'hmm',
  'mm',
  'mhm',
] as const
/** Off by default: they're often real words. */
export const RISKY_FILLERS = ['like'] as const

const norm = (t: string): string => t.toLowerCase().replace(/[^a-z']/g, '')

export interface FillerGroup {
  word: string
  ids: string[]
}

/** Detected filler words grouped by spelling, most common first. */
export function detectFillers(
  words: Word[],
  edits: Record<string, string>,
  include: readonly string[] = [...FILLERS, ...RISKY_FILLERS],
): FillerGroup[] {
  const set = new Set(include)
  const map = new Map<string, string[]>()
  for (const w of words) {
    const k = norm(wordText(w, edits))
    if (!set.has(k)) continue
    const list = map.get(k) ?? []
    list.push(w.id)
    map.set(k, list)
  }
  return [...map.entries()]
    .map(([word, ids]) => ({ word, ids }))
    .sort((a, b) => b.ids.length - a.ids.length)
}

export interface Gap {
  startMs: number
  endMs: number
}

/**
 * Silences between words longer than `thresholdMs`, as ranges that would be
 * shortened to `keepMs` (the middle is removed, so both ends stay natural).
 */
export function longSilences(
  words: Word[],
  deleted: ReadonlySet<string>,
  thresholdMs = 800,
  keepMs = 300,
): Gap[] {
  const kept = words.filter((w) => !deleted.has(w.id))
  const out: Gap[] = []
  for (let i = 0; i + 1 < kept.length; i++) {
    const gap = kept[i + 1].startMs - kept[i].endMs
    if (gap > thresholdMs) {
      const trim = gap - keepMs
      const start = kept[i].endMs + keepMs / 2
      out.push({ startMs: start, endMs: start + trim })
    }
  }
  return out
}
