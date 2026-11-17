import { outputToEdited, type EditList } from '../timeline/editlist'
import type { CaptionLayout, Cue, Word } from './types'

export interface CueOptions {
  maxChars: number
  /** Silence between words that starts a new cue. */
  gapMs: number
  minMs: number
  maxMs: number
}

export const DEFAULT_CUE_OPTIONS: CueOptions = {
  maxChars: 84, // two lines of ~42
  gapMs: 700,
  minMs: 1000,
  maxMs: 6000,
}

const SENTENCE_END = /[.!?…]["')\]]?$/

/** Current text of a word (user edits win). */
export function wordText(w: Word, edits: Record<string, string>): string {
  return (edits[w.id] ?? w.text).trim()
}

interface Placed {
  id: string
  index: number
  text: string
  start: number // edited ms
  end: number
  outStart: number
  outEnd: number
}

/** Kept words with their position on the edited timeline. */
function placeWords(
  words: Word[],
  deleted: ReadonlySet<string>,
  edits: Record<string, string>,
  edit: EditList,
): Placed[] {
  const placed: Placed[] = []
  words.forEach((w, index) => {
    if (deleted.has(w.id)) return
    const text = wordText(w, edits)
    if (!text) return
    const a = outputToEdited(edit, w.startMs + 1)
    const b = outputToEdited(edit, Math.max(w.startMs + 1, w.endMs - 1))
    if (a === null || b === null) return // inside a timeline cut
    placed.push({
      id: w.id,
      index,
      text,
      start: a,
      end: Math.max(a + 1, b),
      outStart: w.startMs,
      outEnd: w.endMs,
    })
  })
  return placed
}

/**
 * Caption cues for the words that remain after the edit, on the *edited*
 * timeline. A cue never spans a cut, so captions stay aligned after any edit.
 */
export function buildCues(
  words: Word[],
  deleted: ReadonlySet<string>,
  edits: Record<string, string>,
  edit: EditList,
  opts: CueOptions = DEFAULT_CUE_OPTIONS,
): Cue[] {
  const placed = placeWords(words, deleted, edits, edit)
  const cues: Cue[] = []
  let cur: Placed[] = []
  const flush = (): void => {
    if (!cur.length) return
    const start = cur[0].start
    let end = cur[cur.length - 1].end
    if (end - start < opts.minMs) end = start + opts.minMs
    if (end - start > opts.maxMs) end = start + opts.maxMs
    const text = cur.map((p) => p.text).join(' ')
    cues.push({
      startMs: start,
      endMs: end,
      text,
      autoText: text,
      key: cur[0].id,
    })
    cur = []
  }
  for (const p of placed) {
    const last = cur[cur.length - 1]
    if (last) {
      const editedGap = p.start - last.end
      const outputGap = p.outStart - last.outEnd
      // A big jump in the source means unrelated speech was cut out between.
      const cutBetween = outputGap > opts.gapMs * 3
      const chars =
        cur.reduce((n, x) => n + x.text.length + 1, 0) + p.text.length
      if (
        cutBetween ||
        editedGap > opts.gapMs ||
        chars > opts.maxChars ||
        SENTENCE_END.test(last.text) ||
        p.end - cur[0].start > opts.maxMs
      )
        flush()
    }
    cur.push(p)
  }
  flush()
  return tidyCues(cues)
}

/** Stop overlapping cues running into each other, and drop empty ones. */
function tidyCues(cues: Cue[]): Cue[] {
  for (let i = 0; i < cues.length - 1; i++)
    if (cues[i].endMs > cues[i + 1].startMs) cues[i].endMs = cues[i + 1].startMs
  return cues.filter((c) => c.endMs > c.startMs)
}

/**
 * Cues from a hand-edited layout. Every word belongs to one caption (its
 * run); a run's timing comes from the words in it that are still kept, and
 * it disappears when none are. Custom text survives word deletes.
 */
export function buildCuesFromLayout(
  words: Word[],
  layout: CaptionLayout,
  deleted: ReadonlySet<string>,
  edits: Record<string, string>,
  edit: EditList,
  opts: CueOptions = DEFAULT_CUE_OPTIONS,
): Cue[] {
  const indexOf = new Map(words.map((w, i) => [w.id, i]))
  const starts = [
    ...new Set(
      layout.breaks
        .map((id) => indexOf.get(id))
        .filter((i): i is number => i !== undefined && i > 0),
    ),
  ].sort((a, b) => a - b)
  const runStarts = words.length ? [0, ...starts] : []
  const placed = placeWords(words, deleted, edits, edit)
  const cues: Cue[] = []
  runStarts.forEach((from, r) => {
    const to = r + 1 < runStarts.length ? runStarts[r + 1] : words.length
    const run = placed.filter((p) => p.index >= from && p.index < to)
    if (!run.length) return
    const key = words[from].id
    const autoText = run.map((p) => p.text).join(' ')
    const custom = layout.text[key]
    const start = run[0].start
    let end = run[run.length - 1].end
    if (end - start < opts.minMs) end = start + opts.minMs
    if (end - start > opts.maxMs) end = start + opts.maxMs
    cues.push({
      startMs: start,
      endMs: end,
      text: custom !== undefined && custom.trim() ? custom : autoText,
      autoText,
      key,
      custom: custom !== undefined && custom.trim() !== '',
    })
  })
  return tidyCues(cues)
}

/** The cue showing at an edited time, if any. Cues are sorted. */
export function cueAt(cues: Cue[], editedMs: number): Cue | null {
  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = cues[mid]
    if (editedMs < c.startMs) hi = mid - 1
    else if (editedMs >= c.endMs) lo = mid + 1
    else return c
  }
  return null
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

function stamp(ms: number, sep: ',' | '.'): string {
  const t = Math.max(0, Math.round(ms))
  return `${pad(Math.floor(t / 3600000))}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)}${sep}${pad(t % 1000, 3)}`
}

/** Break cue text into at most two balanced lines of ~42 characters. */
export function splitLines(text: string, maxLine = 42): string[] {
  if (text.length <= maxLine) return [text]
  const words = text.split(' ')
  let best = 0
  let bestDiff = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length
    const b = words.slice(i).join(' ').length
    const diff = Math.abs(a - b)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  }
  return best
    ? [words.slice(0, best).join(' '), words.slice(best).join(' ')]
    : [text]
}

const cleanSub = (t: string): string =>
  t
    .replace(/-->/g, '→')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{2,}/g, '\n')

/** Manual line breaks win; otherwise balance into at most two lines. */
const subLines = (t: string): string[] =>
  t.includes('\n')
    ? t
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : splitLines(t)

export function toSrt(cues: Cue[]): string {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${stamp(c.startMs, ',')} --> ${stamp(c.endMs, ',')}\n${subLines(cleanSub(c.text)).join('\n')}\n`,
    )
    .join('\n')
}

const escapeVtt = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function toVtt(cues: Cue[]): string {
  return (
    'WEBVTT\n\n' +
    cues
      .map(
        (c) =>
          `${stamp(c.startMs, '.')} --> ${stamp(c.endMs, '.')}\n${subLines(escapeVtt(cleanSub(c.text))).join('\n')}\n`,
      )
      .join('\n')
  )
}
