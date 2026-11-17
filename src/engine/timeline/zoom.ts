/** The part of the take (output ms) shown in the timeline. */
export interface View {
  start: number
  span: number
}

/** Closest the timeline can zoom in. */
export const MIN_SPAN_MS = 1000

export const fullView = (total: number): View => ({
  start: 0,
  span: Math.max(total, 1),
})

/** Keep a view inside the take, with a sensible span. */
export function clampView(v: View, total: number): View {
  const t = Math.max(total, 1)
  const span = Math.min(t, Math.max(Math.min(MIN_SPAN_MS, t), v.span))
  const start = Math.min(Math.max(v.start, 0), t - span)
  return { start, span }
}

/** How many times the take is magnified (1 = whole take). */
export const zoomLevel = (v: View, total: number): number =>
  Math.max(total, 1) / Math.max(v.span, 1)

/**
 * Zoom by `factor` (>1 in), keeping the moment `anchorMs` at the same place
 * on screen, so the playhead or cursor stays put.
 */
export function zoomView(
  v: View,
  total: number,
  factor: number,
  anchorMs: number,
): View {
  const span = v.span / factor
  const frac = v.span > 0 ? (anchorMs - v.start) / v.span : 0.5
  const clampedFrac = Math.min(Math.max(frac, 0), 1)
  return clampView({ start: anchorMs - clampedFrac * span, span }, total)
}

export const panView = (v: View, total: number, deltaMs: number): View =>
  clampView({ start: v.start + deltaMs, span: v.span }, total)

/** Centre the view on a moment. */
export const centerView = (v: View, total: number, ms: number): View =>
  clampView({ start: ms - v.span / 2, span: v.span }, total)

/**
 * Scroll just enough to show `ms`: if it falls outside the middle 90% of the
 * view, put it a fifth of the way in (like a page turn while playing).
 */
export function revealView(v: View, total: number, ms: number): View {
  const margin = v.span * 0.05
  if (ms >= v.start + margin && ms <= v.start + v.span - margin) return v
  return clampView({ start: ms - v.span * 0.2, span: v.span }, total)
}

/** Position of `ms` in the view as a percentage (may be outside 0..100). */
export const viewPct = (v: View, ms: number): number =>
  ((ms - v.start) / v.span) * 100

/** Ruler tick spacing (ms) giving at most ~`max` ticks across the view. */
export function tickStep(spanMs: number, max = 10): number {
  const steps = [
    100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000,
    600000, 1800000, 3600000,
  ]
  return steps.find((s) => spanMs / s <= max) ?? 3600000
}
