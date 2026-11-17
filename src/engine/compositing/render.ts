import type { BubbleShape } from './placement'
import type { Placement } from './types'
import type { CaptionDraw } from '../transcribe/types'

/** What to draw on top of the screen: where the bubble sits and its shape. */
export interface Layout {
  placement: Placement
  shape: BubbleShape
  /** Caption text for this frame (drawn last), if any. */
  caption?: CaptionDraw | null
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
  fill?(): void
  strokeText?(text: string, x: number, y: number): void
  font?: string
  textAlign?: string
  textBaseline?: string
  measureText?(text: string): { width: number }
  fillText?(text: string, x: number, y: number): void
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
  drawBubble(ctx, out, camera, layout)
  if (layout.caption) drawCaption(ctx, out, layout.caption)
}

const CAPTION_SCALE = { small: 0.028, medium: 0.036, large: 0.048 }

/** Break text into lines no wider than `maxWidth` (greedy, by words). */
export function wrapCaption(
  text: string,
  maxWidth: number,
  measure: (t: string) => number,
): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && measure(next) > maxWidth) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** Captions: centred text, optionally on a rounded dark pill. */
export function drawCaption(
  ctx: Ctx2D,
  out: { width: number; height: number },
  c: CaptionDraw,
): void {
  if (!c.text || !ctx.measureText || !ctx.fillText) return
  const size = Math.max(14, Math.round(out.height * CAPTION_SCALE[c.size]))
  ctx.save()
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const measure = (t: string): number => ctx.measureText!(t).width
  const maxW = out.width * 0.84
  const lines = c.text
    .split('\n')
    .flatMap((para) => wrapCaption(para, maxW, measure))
    .slice(-4)
  const lineH = size * 1.3
  const padX = size * 0.6
  const padY = size * 0.35
  const w = Math.max(...lines.map(measure)) + padX * 2
  const h = lines.length * lineH + padY * 2
  const margin = out.height * 0.05
  const x = (out.width - w) / 2
  const y = c.position === 'top' ? margin : out.height - margin - h
  if (c.background) {
    ctx.fillStyle = 'rgba(0,0,0,0.72)'
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, size * 0.4)
    ctx.fill?.()
  }
  lines.forEach((l, i) => {
    const ty = y + padY + lineH * (i + 0.5)
    if (!c.background) {
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.lineWidth = Math.max(2, size * 0.14)
      ctx.strokeText?.(l, out.width / 2, ty)
    }
    ctx.fillStyle = '#fff'
    ctx.fillText!(l, out.width / 2, ty)
  })
  ctx.restore()
}

function drawBubble(
  ctx: Ctx2D,
  out: { width: number; height: number },
  camera: FrameSource | null,
  layout: Layout,
): void {
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
