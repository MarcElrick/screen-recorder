import type { Placement } from './types'

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface BubbleSettings {
  corner: Corner
  /** Bubble width as a fraction of the output width (0.1..0.5). */
  size: number
}

export const DEFAULT_BUBBLE: BubbleSettings = {
  corner: 'bottom-right',
  size: 0.2,
}

const MARGIN = 0.02

/**
 * Normalised placement for a bubble with the given aspect ratio (w/h) on an
 * output with the given aspect ratio.
 */
export function bubblePlacement(
  { corner, size }: BubbleSettings,
  bubbleAspect = 1,
  outputAspect = 16 / 9,
): Placement {
  const width = size
  const height = (size * outputAspect) / bubbleAspect
  const mx = MARGIN
  const my = MARGIN * outputAspect
  const x = corner.endsWith('left') ? mx : 1 - width - mx
  const y = corner.startsWith('top') ? my : 1 - height - my
  return { x, y, width, height }
}

export type BubbleShape = 'circle' | 'rounded'

export const MIN_BUBBLE = 0.08
export const MAX_BUBBLE = 0.6

/** Keep a placement fully inside the canvas. */
export function clampPlacement(p: Placement): Placement {
  const width = Math.min(Math.max(p.width, 0.01), 1)
  const height = Math.min(Math.max(p.height, 0.01), 1)
  return {
    width,
    height,
    x: Math.min(Math.max(p.x, 0), 1 - width),
    y: Math.min(Math.max(p.y, 0), 1 - height),
  }
}

export function movePlacement(p: Placement, dx: number, dy: number): Placement {
  return clampPlacement({ ...p, x: p.x + dx, y: p.y + dy })
}

/** Snap the bubble to a corner, keeping its size. */
export function placementForCorner(
  p: Placement,
  corner: Corner,
  outputAspect = 16 / 9,
): Placement {
  const mx = MARGIN
  const my = MARGIN * outputAspect
  return clampPlacement({
    ...p,
    x: corner.endsWith('left') ? mx : 1 - p.width - mx,
    y: corner.startsWith('top') ? my : 1 - p.height - my,
  })
}

/** Which corner the bubble centre is closest to. */
export function nearestCorner(p: Placement): Corner {
  const cx = p.x + p.width / 2
  const cy = p.y + p.height / 2
  return `${cy < 0.5 ? 'top' : 'bottom'}-${cx < 0.5 ? 'left' : 'right'}` as Corner
}

/** Pixel aspect (w/h) a shape wants: circle is square, rounded is 4:3. */
export function shapeAspect(shape: BubbleShape): number {
  return shape === 'circle' ? 1 : 4 / 3
}

/** Switch shape, keeping the width and centre. */
export function withShape(
  p: Placement,
  shape: BubbleShape,
  outputAspect = 16 / 9,
): Placement {
  const height = (p.width * outputAspect) / shapeAspect(shape)
  const cy = p.y + p.height / 2
  return clampPlacement({ ...p, height, y: cy - height / 2 })
}

/** Resize to a width, keeping the pixel aspect and the top-left anchor. */
export function withWidth(
  p: Placement,
  width: number,
  outputAspect = 16 / 9,
): Placement {
  const w = Math.min(Math.max(width, MIN_BUBBLE), MAX_BUBBLE)
  const pixelAspect = (p.width / p.height) * outputAspect
  const h = (w * outputAspect) / pixelAspect
  return clampPlacement({ x: p.x, y: p.y, width: w, height: h })
}

/**
 * Drag a corner handle to a normalised pointer position. The opposite corner
 * stays fixed and the pixel aspect ratio is preserved.
 */
export function resizeFromCorner(
  p: Placement,
  handle: Corner,
  pointer: { x: number; y: number },
  outputAspect = 16 / 9,
): Placement {
  const left = handle.endsWith('left')
  const top = handle.startsWith('top')
  const ax = left ? p.x + p.width : p.x
  const ay = top ? p.y + p.height : p.y
  const pixelAspect = (p.width / p.height) * outputAspect
  const maxW = Math.min(
    MAX_BUBBLE,
    left ? ax : 1 - ax,
    ((top ? ay : 1 - ay) * pixelAspect) / outputAspect,
  )
  const w = Math.min(
    Math.max(Math.abs(pointer.x - ax), MIN_BUBBLE),
    Math.max(maxW, MIN_BUBBLE),
  )
  const h = (w * outputAspect) / pixelAspect
  return clampPlacement({
    width: w,
    height: h,
    x: left ? ax - w : ax,
    y: top ? ay - h : ay,
  })
}
