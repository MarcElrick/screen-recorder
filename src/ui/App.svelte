<script lang="ts">
  import RecordPage from './record/RecordPage.svelte'

  const steps = [
    { id: 'record', label: 'Record', enabled: true },
    { id: 'compose', label: 'Compose', enabled: false },
    { id: 'export', label: 'Export', enabled: false },
  ]
</script>

<div class="app">
  <header>
    <span class="brand">rec</span>
    <nav aria-label="Steps">
      <ol>
        {#each steps as s, i (s.id)}
          <li
            aria-current={s.id === 'record' ? 'step' : undefined}
            class:active={s.id === 'record'}
            class:disabled={!s.enabled}
          >
            <span class="num">{i + 1}</span>{s.label}
          </li>
        {/each}
      </ol>
    </nav>
  </header>
  <main>
    <RecordPage />
  </main>
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
    gap: var(--space-2);
    color: var(--ink-2);
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
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
