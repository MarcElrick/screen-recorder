import { readCompose, outputDuration } from '../session/compose'
import type { ComposeState } from '../session/compose'
import type { EditList } from '../timeline/editlist'
import { buildCues, buildCuesFromLayout } from './cues'
import { deriveEditList, transcriptCuts } from './cuts'
import type { Envelope } from './envelope'
import { readTranscript, type TranscribedManifest } from './state'
import type { CaptionStyle, Cue, TranscriptState } from './types'

export interface ResolvedEdit {
  compose: ComposeState
  transcript: TranscriptState | null
  /** What Compose, the player and Export play: manual cuts plus deleted words. */
  effective: EditList
  cues: Cue[]
  captions: { cues: Cue[]; style: CaptionStyle } | null
}

/** One place that combines manual edits, transcript deletes and captions. */
export function resolveEdit(
  manifest: TranscribedManifest,
  envelope: Envelope | null,
  compose: ComposeState = readCompose(manifest),
  transcript: TranscriptState | null = readTranscript(manifest),
): ResolvedEdit {
  const total = outputDuration(manifest)
  if (!transcript)
    return {
      compose,
      transcript: null,
      effective: compose.edit,
      cues: [],
      captions: null,
    }
  const effective = deriveEditList(
    compose.edit,
    transcriptCuts(transcript, envelope, total),
  )
  const deleted = new Set(transcript.deletedWordIds)
  const cues = transcript.captionLayout
    ? buildCuesFromLayout(
        transcript.words,
        transcript.captionLayout,
        deleted,
        transcript.text,
        effective,
      )
    : buildCues(transcript.words, deleted, transcript.text, effective)
  return {
    compose,
    transcript,
    effective,
    cues,
    captions: { cues, style: transcript.captions },
  }
}
