import type { Range } from '../timeline/editlist'

/** A transcribed word. Times are on the output timeline (ms, pauses removed). */
export interface Word {
  id: string
  text: string
  startMs: number
  endMs: number
  /** Whisper's own times, kept so alignment can be redone. */
  rawStartMs?: number
  rawEndMs?: number
}

export type CaptionPosition = 'bottom' | 'top'
export type CaptionSize = 'small' | 'medium' | 'large'

export interface CaptionStyle {
  enabled: boolean
  size: CaptionSize
  position: CaptionPosition
  background: boolean
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  enabled: true,
  size: 'medium',
  position: 'bottom',
  background: true,
}

export type ModelId = 'tiny' | 'base' | 'small' | 'large'

/** Transcript stored in session.json under `transcript`. */
export interface TranscriptState {
  version: 1
  model: string
  language: string
  createdAt: string
  words: Word[]
  /** Edited spelling by word id (timing is never changed). */
  text: Record<string, string>
  deletedWordIds: string[]
  /** Word times were aligned to the audio energy (see alignWords). */
  aligned?: boolean
  /** Alignment algorithm version (re-run when it changes). */
  alignVersion?: number
  /** Manual shift applied to every word, for display (ms; negative = earlier). */
  shiftMs?: number
  /** Long silences tightened by the optional tool (output ms). */
  silenceCuts: Range[]
  captions: CaptionStyle
  /** Present once captions have been edited by hand; otherwise grouped automatically. */
  captionLayout?: CaptionLayout
}

/** A caption line group on the *edited* timeline. */
export interface Cue {
  startMs: number
  endMs: number
  /** Caption text; "\n" marks a manual line break. */
  text: string
  /** Id of the first word of the run this cue covers (stable key for edits). */
  key?: string
  /** What the words say, before any custom text. */
  autoText?: string
  /** The text was edited by hand. */
  custom?: boolean
}

/**
 * Hand-edited caption layout, stored on the transcript. `breaks` are the ids
 * of the words that start a caption (the first word always does), so every
 * word belongs to exactly one caption, deleted or not. `text` holds custom
 * text keyed by the id of the first word of a caption.
 */
export interface CaptionLayout {
  breaks: string[]
  text: Record<string, string>
}

/** What the compositor draws for the current frame. */
export interface CaptionDraw {
  text: string
  size: CaptionSize
  position: CaptionPosition
  background: boolean
}
