import type { Range } from '../timeline/editlist'

/** A transcribed word. Times are on the output timeline (ms, pauses removed). */
export interface Word {
  id: string
  text: string
  startMs: number
  endMs: number
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

export type ModelId = 'tiny' | 'base' | 'small'

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
  /** Long silences tightened by the optional tool (output ms). */
  silenceCuts: Range[]
  captions: CaptionStyle
}

/** A caption line group on the *edited* timeline. */
export interface Cue {
  startMs: number
  endMs: number
  text: string
}

/** What the compositor draws for the current frame. */
export interface CaptionDraw {
  text: string
  size: CaptionSize
  position: CaptionPosition
  background: boolean
}
