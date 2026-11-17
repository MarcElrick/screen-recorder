<script lang="ts">
  import { clampPlacement, type Corner, type Placement } from '../../engine'
  import type { ComposeStore } from './compose.svelte'

  let { store }: { store: ComposeStore } = $props()

  let host: HTMLDivElement
  const p = $derived(store.placement)
  const handles: Corner[] = [
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ]

  type Drag =
    | { kind: 'move'; start: { x: number; y: number }; base: Placement }
    | { kind: 'resize'; handle: Corner; base: Placement }
  let drag: Drag | null = null

  function norm(e: PointerEvent): { x: number; y: number } {
    const r = host.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    }
  }

  function down(
    e: PointerEvent,
    d: (pt: { x: number; y: number }) => Drag,
  ): void {
    if (!p) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag = d(norm(e))
  }

  function move(e: PointerEvent): void {
    if (!drag) return
    const pt = norm(e)
    if (drag.kind === 'move') {
      store.setPlacement(
        clampPlacement({
          ...drag.base,
          x: drag.base.x + pt.x - drag.start.x,
          y: drag.base.y + pt.y - drag.start.y,
        }),
        false,
      )
    } else {
      store.setPlacement(
        store.resizeFromHandle(drag.base, drag.handle, pt),
        false,
      )
    }
  }

  function up(): void {
    if (!drag) return
    drag = null
    store.commitBubble()
  }

  function key(e: KeyboardEvent): void {
    if (!p) return
    const big = e.shiftKey ? 0.05 : 0.01
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-big, 0],
      ArrowRight: [big, 0],
      ArrowUp: [0, -big],
      ArrowDown: [0, big],
    }
    const v = d[e.key]
    if (!v) return
    e.preventDefault()
    e.stopPropagation()
    store.setPlacement(
      clampPlacement({ ...p, x: p.x + v[0], y: p.y + v[1] }),
      true,
    )
  }
</script>

<div class="host" bind:this={host}>
  {#if p}
    <div
      class="bubble"
      class:circle={store.shape === 'circle'}
      role="button"
      aria-label="Camera bubble. Drag to move, arrow keys to nudge."
      tabindex="0"
      data-testid="bubble"
      style="left:{p.x * 100}%;top:{p.y * 100}%;width:{p.width *
        100}%;height:{p.height * 100}%"
      onpointerdown={(e) =>
        down(e, (pt) => ({ kind: 'move', start: pt, base: { ...p } }))}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onkeydown={key}
    >
      {#each handles as h (h)}
        <span
          class="handle {h}"
          role="button"
          tabindex="-1"
          aria-label="Resize bubble from {h.replace('-', ' ')}"
          onpointerdown={(e) =>
            down(e, () => ({ kind: 'resize', handle: h, base: { ...p } }))}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={up}
        ></span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .host {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .bubble {
    position: absolute;
    pointer-events: auto;
    cursor: grab;
    touch-action: none;
    border: 2px dashed transparent;
    border-radius: 14%;
  }
  .bubble.circle {
    border-radius: 50%;
  }
  .host:hover .bubble,
  .bubble:focus-visible,
  .bubble:active {
    border-color: var(--accent);
  }
  .handle {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: var(--radius-full);
    background: var(--accent);
    border: 2px solid var(--surface-1);
    touch-action: none;
    opacity: 0;
  }
  .bubble:hover .handle,
  .bubble:focus-visible .handle,
  .bubble:active .handle {
    opacity: 1;
  }
  .top-left {
    left: -7px;
    top: -7px;
    cursor: nwse-resize;
  }
  .top-right {
    right: -7px;
    top: -7px;
    cursor: nesw-resize;
  }
  .bottom-left {
    left: -7px;
    bottom: -7px;
    cursor: nesw-resize;
  }
  .bottom-right {
    right: -7px;
    bottom: -7px;
    cursor: nwse-resize;
  }
</style>
