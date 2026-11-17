<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Progress } from 'bits-ui'
  import { MODELS, sessionLabel, type ModelId } from '../../engine'
  import Button from '../components/Button.svelte'
  import SelectField from '../components/SelectField.svelte'
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

  const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  const store = new AnnotateStore()
  onMount(() => void store.init(sessionId))
  onDestroy(() => store.destroy())

  const takeOptions = $derived(
    store.sessions.map((s) => ({
      id: s.id,
      label: `${sessionLabel(s)} (${formatTime(s.durationMs)})`,
    })),
  )
  const modelOptions = (
    Object.values(MODELS) as (typeof MODELS)[ModelId][]
  ).map((m) => ({
    id: m.id,
    label: `${m.label} (${m.approxMb >= 1000 ? `~${(m.approxMb / 1000).toFixed(1)} GB` : `~${m.approxMb} MB`})${m.needsGpu ? ' · needs a good GPU' : ''}`,
  }))
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
</script>

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
    <header class="head">
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
      {#if store.phase === 'ready'}
        <Button onclick={() => onskip(store.sessionId)}>Skip this step</Button>
      {/if}
    </header>

    {#if store.phase === 'done' && store.transcript}
      <section class="card" aria-label="Transcript ready">
        <h3>Transcript ready</h3>
        <p class="hint">
          {store.transcript.words.length} words, made with the {store.transcript
            .model || 'speech'} model. Edit the words and captions in Compose, alongside
          the preview and timeline.
        </p>
        {#if store.error}<p class="error" role="alert">{store.error}</p>{/if}
        <div class="actions">
          <Button
            variant="primary"
            onclick={async () => {
              await store.flush()
              oncontinue(store.sessionId)
            }}
          >
            Continue to Compose
          </Button>
          <Button onclick={() => (store.phase = 'ready')}>
            Transcribe again…
          </Button>
          <Button onclick={() => void store.discard()}>Remove transcript</Button
          >
        </div>
      </section>
    {:else}
      <section class="card" aria-label="Generate captions">
        <h3>Generate captions</h3>
        <p class="hint">
          Your voice is turned into text on this computer. Nothing is uploaded.
          Then you can delete words to cut them from the video, and the captions
          follow your edits.
        </p>
        {#if store.transcript}
          <p class="error" role="alert">
            Transcribing again replaces this transcript, including your word and
            caption edits.
          </p>
        {/if}
        <SelectField
          label="Model"
          value={store.model}
          options={modelOptions}
          disabled={store.phase === 'working'}
          onchange={(v) => store.setModel(v as ModelId)}
        />
        <p class="hint">{MODELS[store.model].hint}</p>
        {#if MODELS[store.model].needsGpu && !hasGpu}
          <p class="error" role="alert">
            This browser has no WebGPU, so this model would be very slow here.
            Base or Small are better choices.
          </p>
        {/if}
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
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .head h2 {
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
    width: 100%;
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
  .actions {
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
</style>
