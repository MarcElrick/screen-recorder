/** A kept range, in output time (ms, pauses already removed). */
export interface Range {
  startMs: number
  endMs: number
}

/**
 * The composed result: an ordered list of kept ranges. v1 always holds one
 * range covering the whole take; trims and cuts later just edit this list.
 */
export interface EditList {
  version: 1
  ranges: Range[]
}

export function defaultEditList(durationMs: number): EditList {
  return {
    version: 1,
    ranges: [{ startMs: 0, endMs: Math.max(0, durationMs) }],
  }
}

/** Drop invalid ranges, clamp to the take and sort. Never returns empty ranges. */
export function normalizeEditList(edit: unknown, durationMs: number): EditList {
  const raw = (edit as EditList | undefined)?.ranges
  if (!Array.isArray(raw)) return defaultEditList(durationMs)
  const ranges = raw
    .filter(
      (r): r is Range =>
        !!r && Number.isFinite(r.startMs) && Number.isFinite(r.endMs),
    )
    .map((r) => ({
      startMs: Math.min(Math.max(r.startMs, 0), durationMs),
      endMs: Math.min(Math.max(r.endMs, 0), durationMs),
    }))
    .filter((r) => r.endMs > r.startMs)
    .sort((a, b) => a.startMs - b.startMs)
  return ranges.length ? { version: 1, ranges } : defaultEditList(durationMs)
}

export function editedDuration(edit: EditList): number {
  return edit.ranges.reduce((n, r) => n + (r.endMs - r.startMs), 0)
}

/** Edited time -> output (source) time. Clamps to the end. */
export function editedToOutput(edit: EditList, edited: number): number {
  let left = Math.max(0, edited)
  for (const r of edit.ranges) {
    const len = r.endMs - r.startMs
    if (left < len) return r.startMs + left
    left -= len
  }
  const last = edit.ranges[edit.ranges.length - 1]
  return last ? last.endMs : 0
}

/** Output time -> edited time, or null when the point was cut. */
export function outputToEdited(edit: EditList, output: number): number | null {
  let before = 0
  for (const r of edit.ranges) {
    if (output >= r.startMs && output <= r.endMs)
      return before + output - r.startMs
    before += r.endMs - r.startMs
  }
  return null
}
