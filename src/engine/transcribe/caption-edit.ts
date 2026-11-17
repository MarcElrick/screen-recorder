import type { CaptionLayout, Cue, Word } from './types'

/** Turn the automatic grouping into an editable layout (nothing changes visually). */
export function materializeLayout(cues: Cue[], words: Word[]): CaptionLayout {
  const first = words[0]?.id
  return {
    breaks: cues
      .map((c) => c.key)
      .filter((k): k is string => !!k && k !== first),
    text: {},
  }
}

/** Index of the word that starts the caption containing word `index`. */
function runStart(layout: CaptionLayout, words: Word[], index: number): number {
  const at = new Map(words.map((w, i) => [w.id, i]))
  let start = 0
  for (const id of layout.breaks) {
    const i = at.get(id)
    if (i !== undefined && i <= index && i > start) start = i
  }
  return start
}

/** Set (or clear, when it matches the words) the custom text of a caption. */
export function setCaptionText(
  layout: CaptionLayout,
  key: string,
  text: string,
  autoText: string,
): CaptionLayout {
  const next = { ...layout.text }
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  if (!clean || clean === autoText.trim()) delete next[key]
  else next[key] = clean
  return { breaks: [...layout.breaks], text: next }
}

/**
 * Start a new caption at word `index`. The caption it splits loses any custom
 * text, since the words it described are no longer all in it.
 */
export function splitCaptionAt(
  layout: CaptionLayout,
  words: Word[],
  index: number,
): CaptionLayout {
  if (index <= 0 || index >= words.length) return layout
  const id = words[index].id
  if (layout.breaks.includes(id)) return layout
  const text = { ...layout.text }
  delete text[words[runStart(layout, words, index)].id]
  return { breaks: [...layout.breaks, id], text }
}

/**
 * Merge the caption starting at `key` into the one before it. If either has
 * custom text the merged caption keeps both, joined with a space.
 */
export function joinCaptionWithPrevious(
  layout: CaptionLayout,
  words: Word[],
  key: string,
  shown: (key: string) => string,
): CaptionLayout {
  const at = words.findIndex((w) => w.id === key)
  if (at <= 0 || !layout.breaks.includes(key)) return layout
  const prevKey =
    words[
      runStart(
        { ...layout, breaks: layout.breaks.filter((b) => b !== key) },
        words,
        at - 1,
      )
    ].id
  const text = { ...layout.text }
  const custom = text[prevKey] !== undefined || text[key] !== undefined
  if (custom) {
    const merged = [shown(prevKey), shown(key)].filter(Boolean).join(' ')
    text[prevKey] = merged
  }
  delete text[key]
  return { breaks: layout.breaks.filter((b) => b !== key), text }
}

/** Ids that start a caption (including the first word), for marking the transcript. */
export function captionStarts(cues: Cue[]): Set<string> {
  return new Set(cues.map((c) => c.key).filter((k): k is string => !!k))
}
