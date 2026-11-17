import type { SessionManifest } from '../session/manifest'
import {
  DEFAULT_CAPTION_STYLE,
  type CaptionLayout,
  type CaptionStyle,
  type TranscriptState,
  type Word,
} from './types'
import type { Range } from '../timeline/editlist'

export type TranscribedManifest = SessionManifest & {
  transcript?: TranscriptState
}

const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n)

function cleanStyle(s: Partial<CaptionStyle> | undefined): CaptionStyle {
  const d = DEFAULT_CAPTION_STYLE
  return {
    enabled: typeof s?.enabled === 'boolean' ? s.enabled : d.enabled,
    size:
      s?.size === 'small' || s?.size === 'large' || s?.size === 'medium'
        ? s.size
        : d.size,
    position: s?.position === 'top' ? 'top' : 'bottom',
    background:
      typeof s?.background === 'boolean' ? s.background : d.background,
  }
}

function cleanLayout(
  l: CaptionLayout | undefined,
  ids: Set<string>,
): CaptionLayout | undefined {
  if (!l || !Array.isArray(l.breaks)) return undefined
  const text: Record<string, string> = {}
  if (l.text && typeof l.text === 'object')
    for (const [k, v] of Object.entries(l.text))
      if (ids.has(k) && typeof v === 'string') text[k] = v
  return { breaks: l.breaks.filter((id) => ids.has(id)), text }
}

/** Read the transcript from a manifest; malformed data is treated as none. */
export function readTranscript(m: TranscribedManifest): TranscriptState | null {
  const t = m.transcript
  if (!t || !Array.isArray(t.words)) return null
  const words: Word[] = t.words
    .filter(
      (w): w is Word =>
        !!w &&
        typeof w.id === 'string' &&
        typeof w.text === 'string' &&
        finite(w.startMs) &&
        finite(w.endMs),
    )
    .map((w) => ({ ...w, endMs: Math.max(w.endMs, w.startMs) }))
    .sort((a, b) => a.startMs - b.startMs)
  if (!words.length) return null
  const ids = new Set(words.map((w) => w.id))
  const silenceCuts: Range[] = Array.isArray(t.silenceCuts)
    ? t.silenceCuts.filter(
        (r) =>
          !!r && finite(r.startMs) && finite(r.endMs) && r.endMs > r.startMs,
      )
    : []
  return {
    version: 1,
    model: typeof t.model === 'string' ? t.model : '',
    language: typeof t.language === 'string' ? t.language : '',
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : '',
    words,
    text: t.text && typeof t.text === 'object' ? { ...t.text } : {},
    deletedWordIds: Array.isArray(t.deletedWordIds)
      ? t.deletedWordIds.filter((id) => ids.has(id))
      : [],
    silenceCuts,
    aligned: t.aligned === true,
    alignVersion: finite(t.alignVersion) ? t.alignVersion : t.aligned ? 1 : 0,
    shiftMs: finite(t.shiftMs) ? t.shiftMs : 0,
    captions: cleanStyle(t.captions),
    captionLayout: cleanLayout(t.captionLayout, ids),
  }
}

export function withTranscript(
  m: SessionManifest,
  transcript: TranscriptState | undefined,
): TranscribedManifest {
  const next: TranscribedManifest = { ...m }
  if (transcript) next.transcript = transcript
  else delete next.transcript
  return next
}

/** Build stored words from Whisper chunks (times in file seconds). */
export function wordsFromChunks(
  chunks: { text: string; timestamp: [number | null, number | null] }[],
  offsetMs: number,
  totalMs: number,
): Word[] {
  const out: Word[] = []
  for (const c of chunks) {
    const text = c.text.trim()
    if (!text || !c.timestamp) continue
    const [s, e] = c.timestamp
    if (s === null || s === undefined) continue
    const startMs = Math.round(s * 1000 + offsetMs)
    const end = e === null || e === undefined ? s + 0.4 : e
    const endMs = Math.round(end * 1000 + offsetMs)
    if (startMs >= totalMs) continue
    out.push({
      id: `w${out.length}`,
      text,
      startMs: Math.max(0, startMs),
      endMs: Math.min(totalMs, Math.max(endMs, startMs + 1)),
    })
  }
  // Whisper can overlap neighbours slightly; keep strictly ordered.
  for (let i = 1; i < out.length; i++)
    if (out[i].startMs < out[i - 1].endMs)
      out[i - 1].endMs = Math.max(out[i - 1].startMs + 1, out[i].startMs)
  return out
}
