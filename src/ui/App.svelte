<script lang="ts">
  import { onMount } from 'svelte'
  import { SpeechModel, speech, type ModelState } from '../engine'
  import { activity } from './activity.svelte'
  import AnnotatePage from './annotate/AnnotatePage.svelte'
  import ComposePage from './compose/ComposePage.svelte'
  import ExportPage from './export/ExportPage.svelte'
  import RecordPage from './record/RecordPage.svelte'
  import RecoveryBanner from './takes/RecoveryBanner.svelte'
  import TakesPage from './takes/TakesPage.svelte'

  type Page = 'record' | 'annotate' | 'compose' | 'export' | 'takes'
  let page = $state<Page>('record')
  /** The take chosen from the Takes list (otherwise the newest is used). */
  let takeId = $state<string | undefined>()

  const steps: {
    id: Page
    label: string
    enabled: boolean
    optional?: boolean
  }[] = [
    { id: 'record', label: 'Record', enabled: true },
    { id: 'annotate', label: 'Annotate', enabled: true, optional: true },
    { id: 'compose', label: 'Compose', enabled: true },
    { id: 'export', label: 'Export', enabled: true },
  ]

  // The speech model (large) is fetched into the browser cache in the
  // background, once, when the app is idle and nothing is recording, so that
  // Annotate opens with it ready. It is cached, so later visits don't download.
  let model = $state<ModelState>(speech.state)
  let prefetchStarted = false
  onMount(() => speech.subscribe((s) => (model = s)))
  function prefetch(): void {
    if (prefetchStarted || activity.recording || !SpeechModel.supported())
      return
    const conn = (
      navigator as unknown as { connection?: { saveData?: boolean } }
    ).connection
    if (conn?.saveData) return
    prefetchStarted = true
    const run = (): void => {
      speech.load().catch(() => {
        // Offline or blocked: try again later, quietly.
        prefetchStarted = false
      })
    }
    const idle = (
      window as unknown as {
        requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void
      }
    ).requestIdleCallback
    setTimeout(() => (idle ? idle(run, { timeout: 10000 }) : run()), 3000)
  }
  onMount(() => {
    prefetch()
    window.addEventListener('online', prefetch)
    return () => window.removeEventListener('online', prefetch)
  })
  $effect(() => {
    // Recording ended: a deferred prefetch can start.
    if (!activity.recording) prefetch()
  })
  const modelNote = $derived(
    model.status === 'downloading' && !model.cached
      ? `Captions model ${Math.round(model.progress * 100)}%`
      : model.status === 'downloading' || model.status === 'loading'
        ? 'Captions model loading'
        : model.status === 'ready'
          ? 'Captions model ready'
          : '',
  )
</script>

<div class="app">
  <header>
    <span class="brand">rec</span>
    <nav aria-label="Steps">
      <ol>
        {#each steps as s, i (s.id)}
          <li class:active={s.id === page} class:disabled={!s.enabled}>
            <button
              type="button"
              class="step"
              aria-current={s.id === page ? 'step' : undefined}
              disabled={!s.enabled}
              onclick={() => {
                takeId = undefined
                page = s.id
              }}
            >
              <span class="num">{i + 1}</span>{s.label}{#if s.optional}<small
                  class="opt">optional</small
                >{/if}
            </button>
          </li>
        {/each}
      </ol>
    </nav>
    {#if modelNote}
      <span
        class="model"
        role="status"
        title="Speech model for captions, saved in this browser"
        >{modelNote}</span
      >
    {/if}
    <button
      type="button"
      class="takes"
      aria-current={page === 'takes' ? 'page' : undefined}
      onclick={() => (page = 'takes')}
    >
      Takes
    </button>
  </header>
  <RecoveryBanner
    onrecovered={(id) => {
      takeId = id
      page = 'compose'
    }}
  />
  <!-- Record stays mounted (hidden) so live streams survive a trip to Compose. -->
  <main hidden={page !== 'record'}>
    <RecordPage active={page === 'record'} />
  </main>
  {#if page === 'annotate'}
    <main>
      <AnnotatePage
        sessionId={takeId}
        onrecord={() => (page = 'record')}
        onskip={(id) => {
          takeId = id
          page = 'compose'
        }}
        oncontinue={(id) => {
          takeId = id
          page = 'compose'
        }}
      />
    </main>
  {/if}
  {#if page === 'compose'}
    <main>
      <ComposePage sessionId={takeId} onrecord={() => (page = 'record')} />
    </main>
  {/if}
  {#if page === 'takes'}
    <main>
      <TakesPage
        onrecord={() => (page = 'record')}
        onopen={(id, to) => {
          takeId = id
          page = to
        }}
      />
    </main>
  {/if}
  {#if page === 'export'}
    <main>
      <ExportPage {takeId} onrecord={() => (page = 'record')} />
    </main>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    background: var(--surface-1);
  }
  .model {
    margin-left: auto;
    font-size: var(--text-sm);
    color: var(--ink-3);
  }
  .opt {
    margin-left: var(--space-1);
    font-size: 0.7rem;
    color: var(--ink-3);
    font-weight: 400;
  }
  .takes {
    margin-left: auto;
    font: inherit;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--ink-1);
    cursor: pointer;
  }
  .model + .takes {
    margin-left: var(--space-3);
  }
  .takes[aria-current='page'] {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: transparent;
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  ol {
    display: flex;
    gap: var(--space-4);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    color: var(--ink-2);
  }
  .step {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .step:disabled {
    cursor: default;
  }
  li:not(:last-child)::after {
    content: '›';
    margin-left: var(--space-4);
    color: var(--ink-3);
  }
  li.active {
    color: var(--ink-1);
    font-weight: 600;
  }
  li.disabled {
    opacity: 0.55;
  }
  .num {
    display: inline-grid;
    place-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    font-size: var(--text-sm);
  }
  li.active .num {
    background: var(--accent);
    color: var(--accent-ink);
  }
  main[hidden] {
    display: none;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
