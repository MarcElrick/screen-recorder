import type { Interval } from '../recording/clock'

/**
 * Time model.
 *
 * - **Raw time**: ms on the session clock, including paused time.
 * - **Output time**: raw time with pauses removed. MediaRecorder stops
 *   encoding while paused, so both recorded files already live in output time
 *   (offset by where each track started).
 */

export interface TrackSpan {
  /** Raw ms at which the track started recording. */
  startOffsetMs: number
  /** Raw ms at which the track stopped recording. */
  endOffsetMs: number
}

function sorted(pauses: Interval[]): Interval[] {
  return [...pauses].sort((a, b) => a.from - b.from)
}

export function pausedBefore(pauses: Interval[], raw: number): number {
  let total = 0
  for (const p of pauses) {
    total += Math.min(Math.max(raw - p.from, 0), p.to - p.from)
  }
  return total
}

export function rawToOutput(pauses: Interval[], raw: number): number {
  return Math.max(0, raw - pausedBefore(pauses, raw))
}

export function outputToRaw(pauses: Interval[], output: number): number {
  let raw = output
  for (const p of sorted(pauses)) {
    if (raw >= p.from) raw += p.to - p.from
  }
  return raw
}

export function totalOutputMs(
  rawDurationMs: number,
  pauses: Interval[],
): number {
  return rawToOutput(pauses, rawDurationMs)
}

/** Where a track lives on the output timeline. */
export function trackExtent(
  pauses: Interval[],
  track: TrackSpan,
): { start: number; end: number } {
  const start = rawToOutput(pauses, track.startOffsetMs)
  const end = Math.max(start, rawToOutput(pauses, track.endOffsetMs))
  return { start, end }
}

/** Positions of the pauses on the output timeline (for timeline markers). */
export function pauseMarkers(pauses: Interval[]): number[] {
  return sorted(pauses).map((p) => rawToOutput(pauses, p.from))
}
