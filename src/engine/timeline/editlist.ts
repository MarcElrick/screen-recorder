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

/** Shortest range we keep; anything smaller is dropped as a sliver. */
export const MIN_RANGE_MS = 100

function tidy(ranges: Range[]): Range[] {
  const sorted = ranges
    .filter((r) => r.endMs - r.startMs >= MIN_RANGE_MS)
    .sort((a, b) => a.startMs - b.startMs)
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.startMs <= last.endMs)
      last.endMs = Math.max(last.endMs, r.endMs)
    else out.push({ ...r })
  }
  return out
}

/**
 * Remove [startMs, endMs] (output time) from the edit. Returns the edit
 * unchanged if that would leave nothing.
 */
export function cutOutput(
  edit: EditList,
  startMs: number,
  endMs: number,
): EditList {
  const a = Math.min(startMs, endMs)
  const b = Math.max(startMs, endMs)
  if (b - a <= 0) return edit
  const next: Range[] = []
  for (const r of edit.ranges) {
    if (b <= r.startMs || a >= r.endMs) {
      next.push(r)
      continue
    }
    if (a > r.startMs) next.push({ startMs: r.startMs, endMs: a })
    if (b < r.endMs) next.push({ startMs: b, endMs: r.endMs })
  }
  const ranges = tidy(next)
  return ranges.length ? { version: 1, ranges } : edit
}

/** Keep only [startMs, endMs] (output time). Unchanged if that leaves nothing. */
export function keepOutput(
  edit: EditList,
  startMs: number,
  endMs: number,
): EditList {
  const a = Math.min(startMs, endMs)
  const b = Math.max(startMs, endMs)
  const ranges = tidy(
    edit.ranges.map((r) => ({
      startMs: Math.max(r.startMs, a),
      endMs: Math.min(r.endMs, b),
    })),
  )
  return ranges.length ? { version: 1, ranges } : edit
}

/** The parts of [0, totalMs] that the edit removes (output time). */
export function removedRanges(edit: EditList, totalMs: number): Range[] {
  const out: Range[] = []
  let at = 0
  for (const r of edit.ranges) {
    if (r.startMs > at) out.push({ startMs: at, endMs: r.startMs })
    at = Math.max(at, r.endMs)
  }
  if (at < totalMs) out.push({ startMs: at, endMs: totalMs })
  return out
}

export function isUntouched(edit: EditList, totalMs: number): boolean {
  return (
    edit.ranges.length === 1 &&
    edit.ranges[0].startMs <= 0 &&
    edit.ranges[0].endMs >= totalMs
  )
}

/**
 * Output time -> edited time, moving a point that was cut to the start of the
 * next kept range (or the end if nothing follows).
 */
export function outputToEditedSnap(edit: EditList, output: number): number {
  const exact = outputToEdited(edit, output)
  if (exact !== null) return exact
  let before = 0
  for (const r of edit.ranges) {
    if (output < r.startMs) return before
    before += r.endMs - r.startMs
  }
  return before
}
