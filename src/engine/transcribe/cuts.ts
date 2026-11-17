import { cutOutput, type EditList, type Range } from '../timeline/editlist'
import { snapToSilence, type Envelope } from './envelope'
import type { Word } from './types'

export interface CutOptions {
  /** How far a cut edge may move to find silence. */
  snapRadiusMs: number
  /**
   * How far a cut edge may move *later*. Kept small: timestamps tend to run
   * late, and a late edge removes audio that belongs to the next word.
   */
  snapForwardMs: number
  /** Kept before the next kept word (so its onset isn't clipped). */
  padBeforeMs: number
  /** Kept after the previous kept word (so its tail isn't clipped). */
  padAfterMs: number
}

export const DEFAULT_CUT_OPTIONS: CutOptions = {
  snapRadiusMs: 120,
  snapForwardMs: 30,
  padBeforeMs: 30,
  padAfterMs: 20,
}

/**
 * The time ranges (output ms) removed by deleting words. Adjacent deleted
 * words merge into one range, edges snap to the quietest nearby point and
 * never move into a neighbouring kept word.
 */
export function wordCutRanges(
  words: Word[],
  deleted: ReadonlySet<string>,
  env: Envelope | null,
  totalMs: number,
  opts: CutOptions = DEFAULT_CUT_OPTIONS,
): Range[] {
  const out: Range[] = []
  let i = 0
  while (i < words.length) {
    if (!deleted.has(words[i].id)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < words.length && deleted.has(words[j + 1].id)) j++
    const prev = i > 0 ? words[i - 1] : null
    const next = j + 1 < words.length ? words[j + 1] : null
    // Room we may use: after the previous kept word's tail, before the next one's onset.
    const minMs = prev ? prev.endMs + opts.padAfterMs : 0
    const maxMs = next ? next.startMs - opts.padBeforeMs : totalMs
    if (maxMs > minMs) {
      const a = snapToSilence(
        env,
        words[i].startMs,
        opts.snapRadiusMs,
        minMs,
        maxMs,
        opts.snapForwardMs,
      )
      const b = snapToSilence(
        env,
        words[j].endMs,
        opts.snapRadiusMs,
        minMs,
        maxMs,
        opts.snapForwardMs,
      )
      const start = Math.min(a, b)
      const end = Math.max(a, b)
      // A start/end that did not move should still reach the word's own edge
      // when there is no silence to find, but never beyond the free room.
      const s = env ? start : Math.max(minMs, words[i].startMs)
      const e = env ? end : Math.min(maxMs, words[j].endMs)
      if (e > s) out.push({ startMs: s, endMs: e })
    }
    i = j + 1
  }
  return out
}

/**
 * The effective edit: the manual edit with the deleted words' ranges removed.
 * This is what the player, timeline and Export read.
 */
export function deriveEditList(manual: EditList, cuts: Range[]): EditList {
  let edit = manual
  for (const c of cuts) edit = cutOutput(edit, c.startMs, c.endMs)
  return edit
}

/** Whether a word's centre lies inside a manual cut (shown as cut in timeline). */
export function wordIsCutByTimeline(w: Word, manual: EditList): boolean {
  const mid = (w.startMs + w.endMs) / 2
  return !manual.ranges.some((r) => mid >= r.startMs && mid <= r.endMs)
}

export interface TranscriptEditInput {
  words: Word[]
  deletedWordIds: string[]
  silenceCuts: Range[]
}

/** The cuts a transcript contributes: deleted words (snapped) plus tightened silences. */
export function transcriptCuts(
  t: TranscriptEditInput,
  env: Envelope | null,
  totalMs: number,
): Range[] {
  return [
    ...wordCutRanges(t.words, new Set(t.deletedWordIds), env, totalMs),
    ...t.silenceCuts,
  ]
}
