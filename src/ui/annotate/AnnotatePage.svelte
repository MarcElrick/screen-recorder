<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { Progress } from 'bits-ui'
  import { MODELS, sessionLabel, type ModelId } from '../../engine'
  import Button from '../components/Button.svelte'
  import SelectField from '../components/SelectField.svelte'
  import SwitchField from '../components/SwitchField.svelte'
  import { formatTime } from '../record/format'
  import { AnnotateStore } from './annotate.svelte'

  let {
    sessionId,
    onskip,
    oncontinue,
    onrecord,
  }: {
    sessionId?: string
    onskip: (id: string) => void
    oncontinue: (id: string) => void
    onrecord: () => void
  } = $props()

  const store = new AnnotateStore()
  onMount(() => void store.init(sessionId))
  onDestroy(() => {
    stop()
    store.destroy()
  })

  const takeOptions = $derived(
    store.sessions.map((s) => ({
      id: s.id,
      label: `${sessionLabel(s)} (${formatTime(s.durationMs)})`,
    })),
  )
  const modelOptions = (
    Object.values(MODELS) as (typeof MODELS)[ModelId][]
  ).map((m) => ({ id: m.id, label: `${m.label} (~${m.approxMb} MB)` }))
  const languages = [
    { id: 'auto', label: 'Detect language' },
    { id: 'english', label: 'English' },
    { id: 'spanish', label: 'Spanish' },
    { id: 'french', label: 'French' },
    { id: 'german', label: 'German' },
    { id: 'portuguese', label: 'Portuguese' },
    { id: 'italian', label: 'Italian' },
    { id: 'dutch', label: 'Dutch' },
    { id: 'japanese', label: 'Japanese' },
  ]

  // ---- preview -------------------------------------------------------
  let audio = $state<HTMLAudioElement | null>(null)
  let screen = $state<HTMLVideoElement | null>(null)
  let playing = $state(false)
  let outputMs = $state(0)
  let raf = 0

  const activeIndex = $derived.by(() => {
    const ws = store.words
    let lo = 0
    let hi = ws.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (ws[mid].startMs <= outputMs) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return found >= 0 && outputMs <= ws[found].endMs + 250 ? found : -1
  })

  function seek(ms: number): void {
    outputMs = ms
    if (audio) audio.currentTime = Math.max(0, (ms - store.audioStart) / 1000)
    if (screen)
      screen.currentTime = Math.max(0, (ms - store.screenStart) / 1000)
  }
  function loop(): void {
    if (!audio) return
    let ms = audio.currentTime * 1000 + store.audioStart
    // Play what the edit keeps: hop over removed ranges.
    const cut = store.removed.find((r) => ms >= r.startMs && ms < r.endMs)
    if (cut) {
      ms = cut.endMs
      audio.currentTime = (ms - store.audioStart) / 1000
    }
    outputMs = ms
    if (screen) {
      const want = (ms - store.screenStart) / 1000
      if (Math.abs(screen.currentTime - want) > 0.15) screen.currentTime = want
    }
    if (audio.ended) return stop()
    raf = requestAnimationFrame(loop)
  }
  function play(): void {
    if (!audio) return
    if (audio.ended) seek(0)
    void audio.play().catch(() => {})
    void screen?.play().catch(() => {})
    playing = true
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(loop)
  }
  function stop(): void {
    cancelAnimationFrame(raf)
    audio?.pause()
    screen?.pause()
    playing = false
  }

  $effect(() => {
    // Keep the playing word in view.
    if (playing && activeIndex >= 0)
      void tick().then(() =>
        document
          .querySelector(`[data-word="${activeIndex}"]`)
          ?.scrollIntoView({ block: 'nearest' }),
      )
  })

  // ---- transcript interaction ------------------------------------------
  let editing = $state(-1)
  let draft = $state('')

  function clickWord(i: number, e: MouseEvent): void {
    if (e.shiftKey && store.selection) store.select(store.selection.from, i)
    else store.select(i)
    seek(store.words[i].startMs)
  }
  function startEdit(i: number): void {
    editing = i
    draft = store.wordText(store.words[i])
  }
  function finishEdit(save: boolean): void {
    if (editing >= 0 && save) store.setText(store.words[editing].id, draft)
    editing = -1
  }

  function onkeydown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [role="combobox"]')) return
    if (store.phase !== 'editing') return
    const sel = store.selection
    if (e.key === ' ' && !t.closest('button.word')) {
      e.preventDefault()
      if (playing) stop()
      else play()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      store.toggleSelection()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
    } else if (e.key === 'Enter' && sel && sel.from === sel.to) {
      e.preventDefault()
      startEdit(sel.from)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && sel) {
      e.preventDefault()
      const d = e.key === 'ArrowRight' ? 1 : -1
      const max = store.words.length - 1
      if (e.shiftKey) {
        const to = Math.min(max, Math.max(0, sel.to + d))
        store.select(sel.from, to)
      } else {
        const i = Math.min(max, Math.max(0, sel.to + d))
        store.select(i)
        seek(store.words[i].startMs)
      }
    }
  }

  const pct = $derived(Math.round(store.modelState.progress * 100))
  const modelNote = $derived.by(() => {
    const m = store.modelState
    if (m.status === 'downloading' && !m.cached)
      return `Downloading the speech model… ${pct}%`
    if (m.status === 'downloading' || m.status === 'loading')
      return 'Loading the speech model…'
    if (m.status === 'ready')
      return `Speech model ready (${m.device === 'webgpu' ? 'GPU' : 'CPU'})`
    if (store.modelCached) return 'Speech model saved in this browser'
    return `Not downloaded yet (about ${MODELS[store.model].approxMb} MB, one time)`
  })
  const selCount = $derived(
    store.selection ? store.selection.to - store.selection.from + 1 : 0,
  )
  const allDeleted = $derived(
    selCount > 0 && store.selectedIds.every((id) => store.deleted.has(id)),
  )
  const deletedCount = $derived(store.deleted.size)
  const manual = $derived(store.resolved?.compose.edit)
</script>

<svelte:window {onkeydown} />

{#if store.phase === 'loading'}
  <div class="state" role="status"><p>Opening your take…</p></div>
{:else if store.phase === 'unsupported'}
  <div class="state" role="alert">
    <p>This browser can't run the captions step. You can still skip it.</p>
    <Button variant="primary" onclick={() => onskip(store.sessionId)}>
      Skip to Compose
    </Button>
  </div>
{:else if store.phase === 'empty'}
  <div class="state" role="status">
    <p>No recordings yet. Record a take first.</p>
    <Button variant="primary" onclick={onrecord}>Go to Record</Button>
  </div>
{:else if store.phase === 'no-audio'}
  <div class="state" role="status">
    <p>This take has no microphone audio, so there is nothing to transcribe.</p>
    <Button variant="primary" onclick={() => onskip(store.sessionId)}>
      Skip to Compose
    </Button>
  </div>
{:else}
  <div class="page">
    <header class="bar">
      <h2>Annotate <span class="optional">optional</span></h2>
      {#if store.sessions.length > 1}
        <SelectField
          label="Take"
          value={store.sessionId}
          options={takeOptions}
          disabled={store.phase === 'working'}
          onchange={(v) => void store.open(v)}
        />
      {/if}
      <div class="spacer"></div>
      {#if store.phase !== 'working'}
        <Button onclick={() => onskip(store.sessionId)}>
          {store.transcript ? 'Skip' : 'Skip this step'}
        </Button>
        {#if store.transcript}
          <Button
            variant="primary"
            onclick={async () => {
              stop()
              await store.flush()
              oncontinue(store.sessionId)
            }}
          >
            Continue to Compose
          </Button>
        {/if}
      {/if}
    </header>

    {#if store.phase === 'ready' || store.phase === 'working'}
      <section class="card" aria-label="Generate captions">
        <h3>Generate captions</h3>
        <p class="hint">
          Your voice is turned into text on this computer. Nothing is uploaded.
          Delete words from the transcript to cut them from the video, and the
          captions follow your edits.
        </p>
        <SelectField
          label="Model"
          value={store.model}
          options={modelOptions}
          disabled={store.phase === 'working'}
          onchange={(v) => store.setModel(v as ModelId)}
        />
        <p class="hint">{MODELS[store.model].hint}</p>
        <SelectField
          label="Language"
          value={store.language}
          options={languages}
          disabled={store.phase === 'working'}
          onchange={(v) => (store.language = v)}
        />
        <p class="model-note" role="status" data-testid="model-note">
          {modelNote}
        </p>
        {#if store.modelState.status === 'downloading' && !store.modelState.cached}
          <Progress.Root
            value={pct}
            max={100}
            class="bar-track"
            aria-label="Model download"
          >
            <div class="fill" style="width:{pct}%"></div>
          </Progress.Root>
        {/if}
        {#if store.error}<p class="error" role="alert">{store.error}</p>{/if}
        {#if store.phase === 'working'}
          <p role="status" aria-live="polite">{store.step}…</p>
          <div class="actions">
            <Button onclick={() => store.cancel()}>Cancel</Button>
          </div>
        {:else}
          <div class="actions">
            <Button variant="primary" onclick={() => void store.generate()}>
              Generate captions
            </Button>
            <Button onclick={() => onskip(store.sessionId)}>Skip</Button>
          </div>
        {/if}
      </section>
    {:else if store.transcript}
      <div class="editor">
        <section class="preview" aria-label="Preview">
          <video
            bind:this={screen}
            src={store.screenUrl}
            muted
            playsinline
            aria-label="Screen preview"
          ></video>
          <audio bind:this={audio} src={store.cameraUrl} preload="auto"></audio>
          <div class="transport">
            <Button
              variant="primary"
              onclick={() => (playing ? stop() : play())}
            >
              {playing ? 'Pause' : 'Play'}
            </Button>
            <span class="time">{formatTime(Math.max(0, outputMs))}</span>
            <span class="hint">
              {formatTime(store.keptMs)} kept of {formatTime(store.total)}
            </span>
          </div>
        </section>

        <section class="transcript" aria-label="Transcript">
          <div class="tools">
            <Button
              disabled={!selCount}
              onclick={() => store.toggleSelection()}
            >
              {allDeleted ? 'Restore words' : 'Delete words'}
            </Button>
            <Button disabled={!store.canUndo} onclick={() => store.undo()}
              >Undo</Button
            >
            <Button disabled={!store.canRedo} onclick={() => store.redo()}
              >Redo</Button
            >
            <span class="hint">
              Click a word to jump to it, Shift+click to select more, Delete to
              remove, Enter to fix the spelling.
            </span>
          </div>
          <p class="words" data-testid="transcript">
            {#each store.words as w, i (w.id)}
              {#if editing === i}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="edit"
                  aria-label="Word text"
                  bind:value={draft}
                  autofocus
                  size={Math.max(3, draft.length)}
                  onblur={() => finishEdit(true)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') finishEdit(true)
                    if (e.key === 'Escape') finishEdit(false)
                    e.stopPropagation()
                  }}
                />
              {:else}
                {@const status = store.statusOf(w, manual)}
                <button
                  type="button"
                  class="word"
                  class:deleted={status === 'deleted'}
                  class:cut={status === 'cut'}
                  class:active={i === activeIndex}
                  class:selected={store.selection !== null &&
                    i >= store.selection.from &&
                    i <= store.selection.to}
                  data-word={i}
                  data-status={status}
                  aria-pressed={status === 'deleted'}
                  title={status === 'cut'
                    ? 'Already cut in Compose'
                    : undefined}
                  onclick={(e) => clickWord(i, e)}
                  ondblclick={() => startEdit(i)}
                >
                  {store.wordText(w)}
                </button>
              {/if}
            {/each}
          </p>
        </section>

        <aside class="side" aria-label="Captions and tools">
          <h3>Captions</h3>
          <SwitchField
            label="Show captions"
            checked={store.transcript.captions.enabled}
            onchange={(v) => store.setCaptions({ enabled: v })}
          />
          <SelectField
            label="Size"
            value={store.transcript.captions.size}
            options={[
              { id: 'small', label: 'Small' },
              { id: 'medium', label: 'Medium' },
              { id: 'large', label: 'Large' },
            ]}
            onchange={(v) =>
              store.setCaptions({ size: v as 'small' | 'medium' | 'large' })}
          />
          <SelectField
            label="Position"
            value={store.transcript.captions.position}
            options={[
              { id: 'bottom', label: 'Bottom' },
              { id: 'top', label: 'Top' },
            ]}
            onchange={(v) =>
              store.setCaptions({ position: v as 'top' | 'bottom' })}
          />
          <SwitchField
            label="Dark background"
            checked={store.transcript.captions.background}
            onchange={(v) => store.setCaptions({ background: v })}
          />
          <h3>Clean up</h3>
          {#if store.fillers.length}
            <p class="hint">Filler words found (when the model kept them):</p>
            <div class="chips">
              {#each store.fillers as g (g.word)}
                <Button onclick={() => store.removeFillers(g.ids)}>
                  Remove “{g.word}” ×{g.ids.length}
                </Button>
              {/each}
            </div>
          {:else}
            <p class="hint">No filler words found.</p>
          {/if}
          <div class="actions">
            <Button
              disabled={store.silenceGaps.length === 0}
              onclick={() => store.tightenSilences()}
            >
              Shorten long pauses ({store.silenceGaps.length})
            </Button>
            <Button
              disabled={deletedCount === 0 &&
                store.transcript.silenceCuts.length === 0}
              onclick={() => store.restoreAll()}
            >
              Restore all words
            </Button>
          </div>
          <h3>Transcript</h3>
          <p class="hint">
            Made with the {store.transcript.model || 'speech'} model.
          </p>
          <div class="actions">
            <Button
              onclick={() => {
                stop()
                void store.discard()
              }}
            >
              Remove transcript
            </Button>
          </div>
          {#if store.error}<p class="error" role="alert">{store.error}</p>{/if}
        </aside>
      </div>
    {/if}
  </div>
{/if}

<style>
  .state {
    margin: auto;
    display: grid;
    gap: var(--space-3);
    justify-items: center;
    color: var(--ink-2);
  }
  .page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .bar h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .optional {
    margin-left: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--ink-3);
  }
  .spacer {
    flex: 1;
  }
  .card {
    max-width: 520px;
    margin: var(--space-5) auto;
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }
  h3 {
    margin: 0;
    font-size: var(--text-md);
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-3);
  }
  .model-note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .error {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warn-bg);
    color: var(--warn-ink);
  }
  .actions,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  :global(.bar-track) {
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--dur);
  }
  .editor {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(240px, 340px) 1fr 260px;
    gap: var(--space-4);
  }
  .preview {
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }
  .preview video {
    width: 100%;
    background: var(--surface-stage);
    border-radius: var(--radius-md);
    aspect-ratio: 16 / 9;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .time {
    font-family: var(--font-mono);
  }
  .transcript {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .words {
    margin: 0;
    padding: var(--space-4);
    overflow: auto;
    flex: 1;
    line-height: 2;
    font-size: var(--text-lg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }
  .word {
    font: inherit;
    color: var(--ink-1);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0 3px;
    margin: 0;
    cursor: pointer;
  }
  .word:hover {
    background: var(--surface-2);
  }
  .word.active {
    outline: 2px solid var(--accent);
  }
  .word.selected {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .word.deleted {
    color: var(--ink-3);
    text-decoration: line-through;
    opacity: 0.7;
  }
  .word.cut {
    color: var(--ink-3);
    font-style: italic;
    text-decoration: underline dotted;
  }
  .edit {
    font: inherit;
    padding: 0 3px;
    border: 1px solid var(--focus);
    border-radius: var(--radius-sm);
    background: var(--surface-0);
    color: var(--ink-1);
  }
  .side {
    display: grid;
    gap: var(--space-3);
    align-content: start;
    overflow: auto;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }
  @media (max-width: 1000px) {
    .editor {
      grid-template-columns: 1fr;
      overflow: auto;
    }
  }
</style>
