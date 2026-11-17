<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Tabs } from 'bits-ui'
  import { sessionLabel } from '../../engine'
  import Button from '../components/Button.svelte'
  import CornerPicker from '../components/CornerPicker.svelte'
  import SelectField from '../components/SelectField.svelte'
  import ShapePicker from '../components/ShapePicker.svelte'
  import SliderField from '../components/SliderField.svelte'
  import { formatTime } from '../record/format'
  import { ComposeStore } from './compose.svelte'
  import CaptionsPanel from './CaptionsPanel.svelte'
  import Stage from './Stage.svelte'
  import Timeline from './Timeline.svelte'
  import TranscriptPanel from './TranscriptPanel.svelte'

  let {
    sessionId,
    onrecord,
    onannotate,
  }: { sessionId?: string; onrecord: () => void; onannotate: () => void } =
    $props()

  const store = new ComposeStore()
  onMount(() => void store.init(sessionId))
  onDestroy(() => store.destroy())

  let tab = $state<'words' | 'captions' | 'edit' | ''>('')
  // Words first when there is a transcript; otherwise the cut and bubble tools.
  const activeTab = $derived(tab || (store.transcript ? 'words' : 'edit'))

  const options = $derived(
    store.sessions.map((s) => ({
      id: s.id,
      label: `${sessionLabel(s)} (${formatTime(s.durationMs)})`,
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
    } else if (!mod && e.key.toLowerCase() === 'i') {
      store.markIn()
    } else if (!mod && e.key.toLowerCase() === 'o') {
      store.markOut()
    } else if (!mod && (e.key.toLowerCase() === 'x' || e.key === 'Delete')) {
      // With words picked, Delete removes those words (reversibly); X always cuts the range.
      if (e.key === 'Delete' && store.selectedWords) store.toggleSelectedWords()
      else store.cutSelection()
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
        <Button disabled={!store.canUndo} onclick={() => store.undo()}
          >Undo</Button
        >
        <Button disabled={!store.canRedo} onclick={() => store.redo()}
          >Redo</Button
        >
        <span class="time" data-testid="time">
          {formatTime(store.playhead)} / {formatTime(store.duration)}
        </span>
        <span class="status" role="status"
          >{store.saved ? 'Saved' : 'Saving…'}</span
        >
      </div>
      {#if store.error}<p class="error" role="alert">{store.error}</p>{/if}
    </section>

    <aside class="sidebar" aria-label="Edit">
      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => (tab = v as typeof tab)}
        class="stabs"
      >
        <Tabs.List class="stab-list" aria-label="Edit panels">
          {#if store.transcript}
            <Tabs.Trigger value="words" class="stab">Words</Tabs.Trigger>
            <Tabs.Trigger value="captions" class="stab">Captions</Tabs.Trigger>
          {/if}
          <Tabs.Trigger value="edit" class="stab">Edit</Tabs.Trigger>
        </Tabs.List>
        {#if store.transcript}
          <Tabs.Content value="words" class="stab-content">
            <TranscriptPanel {store} />
          </Tabs.Content>
          <Tabs.Content value="captions" class="stab-content">
            <CaptionsPanel {store} />
          </Tabs.Content>
        {/if}
        <Tabs.Content value="edit" class="stab-content">
          <h2>Trim and cut</h2>
          <div class="trim" role="group" aria-label="Trim and cut">
            <div class="actions">
              <Button onclick={() => store.markIn()}>Mark in</Button>
              <Button onclick={() => store.markOut()}>Mark out</Button>
            </div>
            <div class="actions">
              <Button
                disabled={!store.selection}
                onclick={() => store.cutSelection()}
              >
                Cut selection
              </Button>
              <Button
                disabled={!store.selection}
                onclick={() => store.keepSelection()}
              >
                Keep selection
              </Button>
            </div>
            <div class="actions">
              <Button onclick={() => store.trimStart()}>Trim start</Button>
              <Button onclick={() => store.trimEnd()}>Trim end</Button>
            </div>
            <div class="actions">
              <Button
                disabled={!store.edited}
                onclick={() => store.restoreAll()}
              >
                Restore all
              </Button>
            </div>
            <p class="hint">
              Mark in and out (I and O) on the timeline, then cut the selection
              (X). Trim start and end cut up to or from the playhead.
            </p>
          </div>
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
              <Button onclick={() => store.resetBubble()}>Reset bubble</Button>
            </div>
            <p class="hint">
              Drag the bubble in the preview, or use its handles to resize.
            </p>
          {:else}
            <p class="hint">
              This take has no camera video, so there is no bubble to place.
            </p>
          {/if}
          {#if !store.transcript}
            <h2>Captions</h2>
            <p class="hint">
              Transcribe your voice to edit by words and add captions.
            </p>
            <div class="actions">
              <Button onclick={onannotate}>Add captions</Button>
            </div>
          {/if}
        </Tabs.Content>
      </Tabs.Root>
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
    grid-template-columns: 1fr minmax(300px, 400px);
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
  :global(.stabs) {
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }
  :global(.stab-list) {
    display: flex;
    gap: var(--space-1);
    border-bottom: 1px solid var(--border);
  }
  :global(.stab) {
    font: inherit;
    padding: var(--space-2) var(--space-3);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  :global(.stab[data-state='active']) {
    color: var(--ink-1);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
  :global(.stab-content) {
    display: grid;
    gap: var(--space-4);
    align-content: start;
  }
  :global(.stab-content[hidden]) {
    display: none;
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .trim {
    display: grid;
    gap: var(--space-2);
  }
  .actions {
    flex-wrap: wrap;
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
