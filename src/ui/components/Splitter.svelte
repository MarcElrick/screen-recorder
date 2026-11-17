<script lang="ts">
  /**
   * A draggable divider between two panes. `vertical` is a vertical bar that
   * resizes a width; `horizontal` is a horizontal bar that resizes a height.
   * `invert` means the controlled pane grows when the bar moves left or up
   * (a pane on the right or bottom).
   */
  let {
    orientation,
    value,
    min,
    max,
    label,
    invert = false,
    step = 16,
    onchange,
    onreset,
  }: {
    orientation: 'vertical' | 'horizontal'
    value: number
    min: number
    max: number
    label: string
    invert?: boolean
    step?: number
    onchange: (v: number) => void
    onreset?: () => void
  } = $props()

  let drag: { pos: number; value: number } | null = $state(null)

  const clamp = (v: number): number => Math.min(Math.max(v, min), max)
  const axis = (e: { clientX: number; clientY: number }): number =>
    orientation === 'vertical' ? e.clientX : e.clientY

  function down(e: PointerEvent): void {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag = { pos: axis(e), value }
    e.preventDefault()
  }
  function move(e: PointerEvent): void {
    if (!drag) return
    const delta = axis(e) - drag.pos
    onchange(clamp(drag.value + (invert ? -delta : delta)))
  }
  function up(): void {
    drag = null
  }
  function key(e: KeyboardEvent): void {
    const big = e.shiftKey ? 4 : 1
    // Arrow keys move the bar in the direction pressed.
    const dir =
      orientation === 'vertical'
        ? e.key === 'ArrowLeft'
          ? -1
          : e.key === 'ArrowRight'
            ? 1
            : 0
        : e.key === 'ArrowUp'
          ? -1
          : e.key === 'ArrowDown'
            ? 1
            : 0
    if (dir) onchange(clamp(value + (invert ? -dir : dir) * step * big))
    else if (e.key === 'Home') onchange(min)
    else if (e.key === 'End') onchange(max)
    else if (e.key === 'Enter') onreset?.()
    else return
    e.preventDefault()
  }
</script>

<!-- A focusable separator is the standard pattern for a resize handle. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter {orientation}"
  class:active={drag !== null}
  role="separator"
  tabindex="0"
  aria-label={label}
  aria-orientation={orientation}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={Math.round(value)}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={() => onreset?.()}
  onkeydown={key}
>
  <span class="grip"></span>
</div>

<style>
  .splitter {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    background: var(--border);
    touch-action: none;
    user-select: none;
    transition: background var(--dur);
  }
  .splitter.vertical {
    width: 6px;
    cursor: col-resize;
  }
  .splitter.horizontal {
    height: 6px;
    cursor: row-resize;
  }
  .splitter:hover,
  .splitter.active,
  .splitter:focus-visible {
    background: var(--accent);
  }
  .splitter:focus-visible {
    outline: none;
  }
  .grip {
    border-radius: 2px;
    background: var(--ink-3);
    opacity: 0.6;
  }
  .vertical .grip {
    width: 2px;
    height: 28px;
  }
  .horizontal .grip {
    height: 2px;
    width: 28px;
  }
  /* A bigger target than the visible bar. */
  .splitter::before {
    content: '';
    position: absolute;
  }
  .vertical::before {
    inset: 0 -4px;
  }
  .horizontal::before {
    inset: -4px 0;
  }
</style>
