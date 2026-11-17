import type { BubbleShape } from './placement'
import type { Placement } from './types'

/** What to draw on top of the screen: where the bubble sits and its shape. */
export interface Layout {
  placement: Placement
  shape: BubbleShape
}

export interface FrameSource {
  source: unknown
  width: number
  height: number
}

/** The 2D drawing calls the compositor needs (satisfied by canvas contexts). */
export interface Ctx2D {
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  fillRect(x: number, y: number, w: number, h: number): void
  drawImage(img: never, ...args: number[]): void
  save(): void
  restore(): void
  beginPath(): void
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rot: number,
    a0: number,
    a1: number,
  ): void
  roundRect(x: number, y: number, w: number, h: number, r: number): void
  clip(): void
  stroke(): void
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Largest rect with the source's aspect that fits inside the destination. */
export function containRect(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Rect {
  const scale = Math.min(dw / sw, dh / sh)
  const w = sw * scale
  const h = sh * scale
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h }
}

/** Source crop that fills the destination aspect (centre crop). */
export function coverCrop(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Rect {
  const dst = dw / dh
  const src = sw / sh
  if (src > dst) {
    const w = sh * dst
    return { x: (sw - w) / 2, y: 0, w, h: sh }
  }
  const h = sw / dst
  return { x: 0, y: (sh - h) / 2, w: sw, h }
}

export function bubbleGeometry(
  layout: Layout,
  outW: number,
  outH: number,
): Rect & { radius: number } {
  const { placement: p, shape } = layout
  const w = p.width * outW
  const h = p.height * outH
  return {
    x: p.x * outW,
    y: p.y * outH,
    w,
    h,
    radius: shape === 'circle' ? Math.min(w, h) / 2 : Math.min(w, h) * 0.14,
  }
}

/**
 * The one drawing routine shared by the Compose preview and Export, so the
 * preview matches the output. Sources are anything `drawImage` accepts
 * (video element now, VideoFrame later).
 */
export function renderFrame(
  ctx: Ctx2D,
  out: { width: number; height: number },
  screen: FrameSource | null,
  camera: FrameSource | null,
  layout: Layout,
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, out.width, out.height)
  if (screen && screen.width > 0 && screen.height > 0) {
    const r = containRect(screen.width, screen.height, out.width, out.height)
    ctx.drawImage(screen.source as never, r.x, r.y, r.w, r.h)
  }
  if (!camera || camera.width <= 0 || camera.height <= 0) return
  const g = bubbleGeometry(layout, out.width, out.height)
  const c = coverCrop(camera.width, camera.height, g.w, g.h)
  ctx.save()
  ctx.beginPath()
  if (layout.shape === 'circle') {
    ctx.ellipse(
      g.x + g.w / 2,
      g.y + g.h / 2,
      g.w / 2,
      g.h / 2,
      0,
      0,
      Math.PI * 2,
    )
  } else {
    ctx.roundRect(g.x, g.y, g.w, g.h, g.radius)
  }
  ctx.clip()
  ctx.drawImage(camera.source as never, c.x, c.y, c.w, c.h, g.x, g.y, g.w, g.h)
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  if (layout.shape === 'circle') {
    ctx.ellipse(
      g.x + g.w / 2,
      g.y + g.h / 2,
      g.w / 2,
      g.h / 2,
      0,
      0,
      Math.PI * 2,
    )
  } else {
    ctx.roundRect(g.x, g.y, g.w, g.h, g.radius)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = Math.max(2, out.width * 0.002)
  ctx.stroke()
  ctx.restore()
}
