<script lang="ts">
  import { tickStep, viewPct } from '../../engine'
  import Button from '../components/Button.svelte'
  import { formatTime } from '../record/format'
  import type { ComposeStore } from './compose.svelte'
  import Overview from './Overview.svelte'

  let { store, height }: { store: ComposeStore; height: number } = $props()

  let area: HTMLDivElement
  let scrubbing = false

  const dur = $derived(Math.max(store.outputTotal, 1))
  // The view is the zoomed window; at 1x it is the whole take.
  const pct = (ms: number): number => viewPct(store.view, ms)
  const ticks = $derived.by(() => {
    const v = store.view
    const step = tickStep(v.span)
    const out: number[] = []
    for (
      let t = Math.ceil(v.start / step) * step;
      t <= v.start + v.span;
      t += step
    )
      out.push(t)
    return { out, step }
  })
  const tickLabel = (ms: number): string =>
    ticks.step < 1000
      ? `${formatTime(ms)}.${Math.round((ms % 1000) / 100)}`
      : formatTime(ms)

  const DRAG_PX = 4
  let anchor = { x: 0, ms: 0 }
  let dragging = $state(false)

  function msAt(e: { clientX: number }): number {
    const r = area.getBoundingClientRect()
    const f = (e.clientX - r.left) / r.width
    const v = store.view
    return Math.min(
      Math.max(v.start + Math.min(Math.max(f, 0), 1) * v.span, 0),
      dur,
    )
  }
  function down(e: PointerEvent): void {
    scrubbing = true
    dragging = false
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    anchor = { x: e.clientX, ms: msAt(e) }
    store.seekOutput(anchor.ms)
  }
  function move(e: PointerEvent): void {
    if (!scrubbing) return
    // Drag past a few pixels to select a range; a plain click just seeks.
    if (!dragging && Math.abs(e.clientX - anchor.x) >= DRAG_PX) dragging = true
    if (dragging) store.selectRange(anchor.ms, msAt(e))
    else store.seekOutput(msAt(e))
  }
  function up(): void {
    scrubbing = false
    dragging = false
  }
  function key(e: KeyboardEvent): void {
    const step = e.shiftKey ? 5000 : 1000
    if (e.key === 'ArrowLeft') store.step(-step)
    else if (e.key === 'ArrowRight') store.step(step)
    else if (e.key === 'Home') store.seek(0)
    else if (e.key === 'End') store.seek(store.duration)
    else if (e.key === '+' || e.key === '=') store.zoomBy(1.5)
    else if (e.key === '-' || e.key === '_') store.zoomBy(1 / 1.5)
    else if (e.key === '0') store.zoomFit()
    else return
    e.preventDefault()
  }

  // Ctrl/Cmd + wheel (and trackpad pinch, which arrives the same way) zooms
  // around the pointer; sideways scroll or Shift + wheel pans.
  $effect(() => {
    const el = area
    const onwheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01))
        store.zoomBy(factor, msAt(e))
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const d = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
        store.panBy((d / r.width) * store.view.span)
      }
    }
    el.addEventListener('wheel', onwheel, { passive: false })
    return () => el.removeEventListener('wheel', onwheel)
  })

  // While playing, keep the playhead in view when zoomed.
  $effect(() => {
    if (store.playing && store.zoom > 1.001) store.reveal(store.playheadOutput)
  })

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
  const zoomText = $derived(
    store.zoom < 1.05
      ? 'Whole take'
      : `${store.zoom.toFixed(store.zoom < 10 ? 1 : 0)}×`,
  )
</script>

<section class="timeline" aria-label="Timeline" style:height="{height}px">
  <div class="bar">
    <span class="zoom-label" data-testid="zoom-level" aria-live="polite">
      {zoomText}
    </span>
    <Button
      aria-label="Zoom out"
      disabled={store.zoom <= 1.001}
      onclick={() => store.zoomBy(1 / 1.5)}
    >
      −
    </Button>
    <Button
      aria-label="Zoom in"
      disabled={store.view.span <= 1000}
      onclick={() => store.zoomBy(1.5)}
    >
      +
    </Button>
    <Button disabled={store.zoom <= 1.001} onclick={() => store.zoomFit()}>
      Fit
    </Button>
    <span class="hint"
      >Ctrl + scroll or pinch to zoom, Shift + scroll to pan</span
    >
  </div>
  <div class="main">
    <div class="labels" aria-hidden="true">
      <div class="ruler-gap"></div>
      {#each store.rows as row (row.id)}
        <div class="label">{row.label}</div>
      {/each}
    </div>
    <div
      class="area"
      bind:this={area}
      role="slider"
      tabindex="0"
      aria-label="Playhead"
      aria-valuemin="0"
      aria-valuemax={Math.round(store.duration)}
      aria-valuenow={Math.round(store.playhead)}
      aria-valuetext={formatTime(store.playhead)}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onkeydown={key}
    >
      <div class="ruler">
        {#each ticks.out as t (t)}
          <span class="tick" style="left:{pct(t)}%">{tickLabel(t)}</span>
        {/each}
      </div>
      {#each store.rows as row (row.id)}
        <div class="row">
          <div
            class="clip {row.id}"
            style="left:{pct(row.start)}%;width:{pct(row.end) -
              pct(row.start)}%"
            title={row.note ?? row.label}
          >
            {#if row.id === 'audio' && store.peaks}
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d={bars(store.peaks)}
                  vector-effect="non-scaling-stroke"
                />
              </svg>
            {/if}
          </div>
        </div>
      {/each}
      {#each store.removed as r (r.startMs)}
        <span
          class="cut"
          data-testid="cut"
          style="left:{pct(r.startMs)}%;width:{pct(r.endMs) - pct(r.startMs)}%"
          title="Cut out"
        ></span>
      {/each}
      {#if store.selection}
        <span
          class="selection"
          class:dragging
          data-testid="selection"
          style="left:{pct(store.selection.start)}%;width:{pct(
            store.selection.end,
          ) - pct(store.selection.start)}%"
        ></span>
      {/if}
      {#each store.markers as m (m)}
        <span class="pause" style="left:{pct(m)}%" title="Paused here"></span>
      {/each}
      <span
        class="playhead"
        style="left:{pct(store.playheadOutput)}%"
        data-testid="playhead"
      ></span>
    </div>
  </div>
  <Overview {store} />
</section>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    padding: var(--space-2) var(--space-4) var(--space-3);
    border-top: 1px solid var(--border);
    background: var(--surface-1);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .bar :global(.btn) {
    padding: 2px var(--space-3);
  }
  .zoom-label {
    min-width: 5.5em;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .hint {
    margin-left: auto;
    font-size: var(--text-sm);
    color: var(--ink-3);
  }
  .main {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: var(--space-2);
  }
  .labels,
  .area {
    display: grid;
    grid-template-rows: 22px minmax(36px, 1fr);
    min-height: 0;
  }
  .ruler-gap,
  .ruler {
    height: 22px;
  }
  .area {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    border-radius: var(--radius-sm);
  }
  .label {
    display: flex;
    align-items: center;
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .ruler {
    position: relative;
    border-bottom: 1px solid var(--border);
  }
  .tick {
    position: absolute;
    font-size: 0.7rem;
    color: var(--ink-3);
    transform: translateX(-2px);
    font-family: var(--font-mono);
    white-space: nowrap;
  }
  .row {
    position: relative;
    border-bottom: 1px solid var(--surface-2);
  }
  .clip {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 30%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--accent) 60%, transparent);
    overflow: hidden;
  }
  .clip.audio {
    background: var(--surface-2);
    border-color: var(--border);
  }
  svg {
    width: 100%;
    height: 100%;
  }
  path {
    stroke: var(--ink-2);
    stroke-width: 1;
    fill: none;
  }
  .cut {
    position: absolute;
    top: 22px;
    bottom: 0;
    background: repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--rec) 22%, transparent) 0 6px,
      transparent 6px 12px
    );
    border-left: 1px solid var(--rec);
    border-right: 1px solid var(--rec);
    pointer-events: none;
  }
  .selection {
    position: absolute;
    top: 22px;
    bottom: 0;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-left: 2px solid var(--accent);
    border-right: 2px solid var(--accent);
    pointer-events: none;
  }
  .selection.dragging {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .pause {
    position: absolute;
    top: 22px;
    bottom: 0;
    width: 0;
    border-left: 2px dashed var(--warn-ink);
    opacity: 0.7;
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
</style>
