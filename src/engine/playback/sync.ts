export interface SyncInput {
  /** Playhead on the output timeline (ms). */
  outputMs: number
  /** Where the track lives on the output timeline (ms). */
  extent: { start: number; end: number }
  /** The media element's current time (seconds). */
  currentTime: number
  playing: boolean
}

export interface SyncPlan {
  /** Whether the track has content at this playhead. */
  active: boolean
  /** Seek the element to this time (seconds), if not null. */
  seekTo: number | null
  shouldPlay: boolean
}

export const DRIFT_PLAYING_S = 0.08
export const DRIFT_PAUSED_S = 0.02

/** Pure decision for slaving one media element to the shared playhead. */
export function planSync(i: SyncInput): SyncPlan {
  const active = i.outputMs >= i.extent.start && i.outputMs <= i.extent.end
  if (!active) return { active: false, seekTo: null, shouldPlay: false }
  const target = (i.outputMs - i.extent.start) / 1000
  const tol = i.playing ? DRIFT_PLAYING_S : DRIFT_PAUSED_S
  const seekTo = Math.abs(i.currentTime - target) > tol ? target : null
  return { active: true, seekTo, shouldPlay: i.playing }
}
