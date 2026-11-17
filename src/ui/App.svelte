<script lang="ts">
  import ComposePage from './compose/ComposePage.svelte'
  import ExportPage from './export/ExportPage.svelte'
  import RecordPage from './record/RecordPage.svelte'

  type Page = 'record' | 'compose' | 'export'
  let page = $state<Page>('record')

  const steps: { id: Page; label: string; enabled: boolean }[] = [
    { id: 'record', label: 'Record', enabled: true },
    { id: 'compose', label: 'Compose', enabled: true },
    { id: 'export', label: 'Export', enabled: true },
  ]
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
              onclick={() => (page = s.id)}
            >
              <span class="num">{i + 1}</span>{s.label}
            </button>
          </li>
        {/each}
      </ol>
    </nav>
  </header>
  <!-- Record stays mounted (hidden) so live streams survive a trip to Compose. -->
  <main hidden={page !== 'record'}>
    <RecordPage />
  </main>
  {#if page === 'compose'}
    <main>
      <ComposePage onrecord={() => (page = 'record')} />
    </main>
  {/if}
  {#if page === 'export'}
    <main>
      <ExportPage onrecord={() => (page = 'record')} />
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
