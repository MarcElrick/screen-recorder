<script lang="ts">
  import { MIN_SPAN_MS, viewPct } from '../../engine'
  import { formatTime } from '../record/format'
  import type { ComposeStore } from './compose.svelte'

  let { store }: { store: ComposeStore } = $props()

  let strip: HTMLDivElement
  const dur = $derived(Math.max(store.outputTotal, 1))
  // Everything on the strip is drawn against the whole take.
  const pct = (ms: number): number => viewPct({ start: 0, span: dur }, ms)
  const zoomed = $derived(store.zoom > 1.001)

  let mode: 'pan' | 'left' | 'right' | null = null
  let grab = { ms: 0, start: 0, span: 0 }

  function msAt(e: { clientX: number }): number {
    const r = strip.getBoundingClientRect()
    const f = (e.clientX - r.left) / r.width
    return Math.min(Math.max(f, 0), 1) * dur
  }

  function down(e: PointerEvent): void {
    const t = e.target as HTMLElement
    const ms = msAt(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (t.dataset.part === 'left') mode = 'left'
    else if (t.dataset.part === 'right') mode = 'right'
    else {
      mode = 'pan'
      // Clicking outside the window moves it there; then drag to keep moving.
      if (!t.dataset.part) store.centerOn(ms)
    }
    // Read the view after a possible re-centre, so panning starts from there.
    grab = { ms, start: store.view.start, span: store.view.span }
  }
  function move(e: PointerEvent): void {
    if (!mode) return
    const ms = msAt(e)
    const end0 = grab.start + grab.span
    if (mode === 'pan') {
      store.setView({ start: grab.start + (ms - grab.ms), span: grab.span })
    } else if (mode === 'left') {
      const start = Math.min(ms, end0 - MIN_SPAN_MS)
      store.setView({ start, span: end0 - start })
    } else {
      const end = Math.max(ms, grab.start + MIN_SPAN_MS)
      store.setView({ start: grab.start, span: end - grab.start })
    }
  }
  function up(): void {
    mode = null
  }
  function key(e: KeyboardEvent): void {
    const v = store.view
    if (e.key === 'ArrowLeft') store.panBy(-v.span * (e.shiftKey ? 0.5 : 0.1))
    else if (e.key === 'ArrowRight')
      store.panBy(v.span * (e.shiftKey ? 0.5 : 0.1))
    else if (e.key === '+' || e.key === '=')
      store.zoomBy(1.5, v.start + v.span / 2)
    else if (e.key === '-' || e.key === '_')
      store.zoomBy(1 / 1.5, v.start + v.span / 2)
    else if (e.key === '0') store.zoomFit()
    else return
    e.preventDefault()
  }

  function bars(peaks: number[]): string {
    const n = peaks.length
    return peaks
      .map((v, i) => {
        const x = (i / n) * 100
        const h = Math.max(v, 0.02) * 100
        return `M${x.toFixed(3)} ${(50 - h / 2).toFixed(2)}V${(50 + h / 2).toFixed(2)}`
      })
      .join('')
  }
  const audio = $derived(store.rows.find((r) => r.id === 'audio'))
</script>

<div class="ov">
  <div class="label" aria-hidden="true">Overview</div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="strip"
    bind:this={strip}
    data-testid="overview"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    {#if store.peaks && audio}
      <svg
        class="wave"
        style="left:{pct(audio.start)}%;width:{pct(audio.end) -
          pct(audio.start)}%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={bars(store.peaks)} vector-effect="non-scaling-stroke" />
      </svg>
    {/if}
    {#each store.removed as r (r.startMs)}
      <span
        class="cut"
        data-testid="ov-cut"
        style="left:{pct(r.startMs)}%;width:{pct(r.endMs) - pct(r.startMs)}%"
      ></span>
    {/each}
    {#if store.selection}
      <span
        class="selection"
        style="left:{pct(store.selection.start)}%;width:{pct(
          store.selection.end,
        ) - pct(store.selection.start)}%"
      ></span>
    {/if}
    <span class="playhead" style="left:{pct(store.playheadOutput)}%"></span>
    <div
      class="window"
      class:zoomed
      data-part="window"
      role="slider"
      tabindex="0"
      aria-label="Visible range"
      aria-valuemin="0"
      aria-valuemax={Math.round(dur)}
      aria-valuenow={Math.round(store.view.start)}
      aria-valuetext={`${formatTime(store.view.start)} to ${formatTime(store.view.start + store.view.span)}`}
      style="left:{pct(store.view.start)}%;width:{pct(store.view.span)}%"
      onkeydown={key}
    >
      <span class="handle left" data-part="left"></span>
      <span class="handle right" data-part="right"></span>
    </div>
  </div>
</div>

<style>
  .ov {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: var(--space-2);
    height: 38px;
  }
  .label {
    display: flex;
    align-items: center;
    font-size: var(--text-sm);
    color: var(--ink-3);
  }
  .strip {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border);
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }
  .wave {
    position: absolute;
    top: 0;
    height: 100%;
    opacity: 0.8;
  }
  path {
    stroke: var(--ink-3);
    stroke-width: 1;
    fill: none;
  }
  .cut {
    position: absolute;
    top: 0;
    bottom: 0;
    background: repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--rec) 30%, transparent) 0 4px,
      transparent 4px 8px
    );
    border-left: 1px solid var(--rec);
    border-right: 1px solid var(--rec);
    pointer-events: none;
  }
  .selection {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    pointer-events: none;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--rec);
    pointer-events: none;
  }
  .window {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    border: 2px solid var(--accent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    cursor: grab;
    outline-offset: 2px;
  }
  .window:not(.zoomed) {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: none;
    cursor: pointer;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 10px;
    cursor: ew-resize;
  }
  .handle::after {
    content: '';
    position: absolute;
    top: 25%;
    bottom: 25%;
    left: 3px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .handle.left {
    left: -6px;
  }
  .handle.right {
    right: -6px;
  }
</style>
