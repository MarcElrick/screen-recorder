import type { Placement } from '../compositing/types'
import {
  DEFAULT_BUBBLE,
  bubblePlacement,
  clampPlacement,
  type BubbleShape,
} from '../compositing/placement'
import {
  defaultEditList,
  normalizeEditList,
  type EditList,
} from '../timeline/editlist'
import { totalOutputMs } from '../timeline/time'
import type { SessionManifest } from './manifest'

export interface ComposeBubble {
  shape: BubbleShape
  placement: Placement
}

/** Edits made in Compose, stored in session.json under `compose`. */
export interface ComposeState {
  version: 1
  edit: EditList
  bubble: ComposeBubble
}

export type ComposedManifest = SessionManifest & { compose?: ComposeState }

const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n)

function validPlacement(p: unknown): p is Placement {
  const q = p as Placement | undefined
  return (
    !!q &&
    finite(q.x) &&
    finite(q.y) &&
    finite(q.width) &&
    finite(q.height) &&
    q.width > 0 &&
    q.height > 0
  )
}

/** Output duration of a take (pauses removed). */
export function outputDuration(m: SessionManifest): number {
  return Math.round(totalOutputMs(m.durationMs, m.pauses))
}

/**
 * Read the compose state from a manifest, falling back to what Record saved.
 * Old sessions (no `compose`) and malformed data both load with defaults.
 */
export function readCompose(m: ComposedManifest): ComposeState {
  const duration = outputDuration(m)
  const saved = m.compose
  const recorded = m.bubble?.placement
  const fallback = validPlacement(recorded)
    ? recorded
    : bubblePlacement(DEFAULT_BUBBLE)
  const placement = validPlacement(saved?.bubble?.placement)
    ? saved.bubble.placement
    : fallback
  const shape: BubbleShape =
    saved?.bubble?.shape === 'rounded' ? 'rounded' : 'circle'
  return {
    version: 1,
    edit: saved
      ? normalizeEditList(saved.edit, duration)
      : defaultEditList(duration),
    bubble: { shape, placement: clampPlacement(placement) },
  }
}

export function withCompose(
  m: SessionManifest,
  compose: ComposeState,
): ComposedManifest {
  return { ...m, compose }
}
