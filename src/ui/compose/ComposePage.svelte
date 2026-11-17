<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import Button from '../components/Button.svelte'
  import CornerPicker from '../components/CornerPicker.svelte'
  import SelectField from '../components/SelectField.svelte'
  import ShapePicker from '../components/ShapePicker.svelte'
  import SliderField from '../components/SliderField.svelte'
  import { formatTime } from '../record/format'
  import { ComposeStore } from './compose.svelte'
  import Stage from './Stage.svelte'
  import Timeline from './Timeline.svelte'

  let { sessionId, onrecord }: { sessionId?: string; onrecord: () => void } =
    $props()

  const store = new ComposeStore()
  onMount(() => void store.init(sessionId))
  onDestroy(() => store.destroy())

  const options = $derived(
    store.sessions.map((s) => ({
      id: s.id,
      label: `${new Date(s.createdAt).toLocaleString()} (${formatTime(s.durationMs)})`,
    })),
  )

  function onkeydown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, button, [role="combobox"]')) return
    const mod = e.ctrlKey || e.metaKey
    if (e.key === ' ') {
      e.preventDefault()
      store.toggle()
    } else if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      store.redo()
    }
  }
</script>

<svelte:window {onkeydown} />

{#if store.loading}
  <div class="state" role="status">Loading take…</div>
{:else if !store.session}
  <div class="state" role={store.error ? 'alert' : 'status'}>
    <p>{store.error || 'No recordings yet. Record a take first.'}</p>
    <Button variant="primary" onclick={onrecord}>Go to Record</Button>
  </div>
{:else}
  <div class="layout">
    <section class="stage" aria-label="Preview">
      <div class="canvas-wrap">
        {#key store.sessionId}
          <Stage {store} />
        {/key}
      </div>
      <div class="transport">
        <Button variant="primary" onclick={() => store.toggle()}>
          {store.playing ? 'Pause' : 'Play'}
        </Button>
        <span class="time" data-testid="time">
          {formatTime(store.playhead)} / {formatTime(store.duration)}
        </span>
        <span class="status" role="status"
          >{store.saved ? 'Saved' : 'Saving…'}</span
        >
      </div>
      {#if store.error}<p class="error" role="alert">{store.error}</p>{/if}
    </section>

    <aside class="sidebar" aria-label="Bubble">
      <h2>Camera bubble</h2>
      {#if store.sessions.length > 1}
        <SelectField
          label="Take"
          value={store.sessionId}
          {options}
          onchange={(v) => void store.open(v)}
        />
      {/if}
      {#if store.hasCameraVideo && store.cameraUrl}
        <CornerPicker bind:value={store.corner} />
        <ShapePicker bind:value={store.shape} />
        <SliderField
          label="Bubble size"
          bind:value={store.width}
          min={0.08}
          max={0.6}
        />
        <div class="actions">
          <Button disabled={!store.canUndo} onclick={() => store.undo()}
            >Undo</Button
          >
          <Button disabled={!store.canRedo} onclick={() => store.redo()}
            >Redo</Button
          >
          <Button onclick={() => store.resetBubble()}>Reset</Button>
        </div>
        <p class="hint">
          Drag the bubble in the preview, or use its handles to resize.
        </p>
      {:else}
        <p class="hint">
          This take has no camera video, so there is no bubble to place.
        </p>
      {/if}
    </aside>
  </div>
  <Timeline {store} />
{/if}

<style>
  .state {
    margin: auto;
    display: grid;
    gap: var(--space-3);
    justify-items: center;
    color: var(--ink-2);
  }
  .layout {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 280px;
  }
  .stage {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .canvas-wrap {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    container-type: size;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .time {
    font-family: var(--font-mono);
  }
  .status {
    margin-left: auto;
    font-size: var(--text-sm);
    color: var(--ink-3);
  }
  .error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warn-bg);
    color: var(--warn-ink);
  }
  .sidebar {
    border-left: 1px solid var(--border);
    background: var(--surface-1);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-4);
    align-content: start;
    overflow: auto;
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-3);
  }
  @media (max-width: 800px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .sidebar {
      border-left: none;
      border-top: 1px solid var(--border);
    }
  }
</style>
