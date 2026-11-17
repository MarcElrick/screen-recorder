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
