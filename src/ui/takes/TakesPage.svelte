<script lang="ts">
  import { onMount } from 'svelte'
  import { AlertDialog } from 'bits-ui'
  import {
    deleteSession,
    formatBytes,
    listSessions,
    renameSession,
    sessionLabel,
    storageUsage,
    type SessionSummary,
  } from '../../engine'
  import Button from '../components/Button.svelte'
  import { formatTime } from '../record/format'

  let {
    onopen,
    onrecord,
  }: {
    onopen: (id: string, page: 'compose' | 'export') => void
    onrecord: () => void
  } = $props()

  let takes = $state<SessionSummary[]>([])
  let loaded = $state(false)
  let error = $state('')
  let usage = $state<{ usage: number; quota: number } | null>(null)
  let renaming = $state('')
  let draft = $state('')
  let toDelete = $state<SessionSummary | null>(null)
  let confirmAll = $state(false)

  function summary(t: SessionSummary): string {
    const base =
      t.mainSource === 'camera'
        ? 'camera only'
        : t.hasCameraVideo
          ? 'screen + camera'
          : 'screen only'
    return base + (t.hasAudio ? ' + mic' : '')
  }

  const total = $derived(takes.reduce((n, t) => n + t.sizeBytes, 0))
  const usedPct = $derived(
    usage ? Math.min(100, (usage.usage / usage.quota) * 100) : 0,
  )

  async function refresh(): Promise<void> {
    try {
      takes = await listSessions()
      usage = await storageUsage()
    } catch {
      error = 'Could not read your saved takes.'
    } finally {
      loaded = true
    }
  }
  onMount(() => void refresh())

  function startRename(t: SessionSummary): void {
    renaming = t.id
    draft = t.name ?? ''
  }
  async function commitRename(): Promise<void> {
    const id = renaming
    renaming = ''
    if (!id) return
    try {
      await renameSession(id, draft)
      error = ''
    } catch {
      error = 'Could not rename that take.'
    }
    await refresh()
  }

  async function remove(ids: string[]): Promise<void> {
    try {
      for (const id of ids) await deleteSession(id)
      error = ''
    } catch {
      error = 'Could not delete everything. Try again.'
    }
    await refresh()
  }
</script>

<div class="page">
  <header class="head">
    <h2>Takes</h2>
    <div class="storage" aria-label="Storage">
      <span
        >{takes.length}
        {takes.length === 1 ? 'take' : 'takes'}, {formatBytes(total)}</span
      >
      {#if usage}
        <span
          class="bar"
          role="meter"
          aria-label="Browser storage used"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(usedPct)}
        >
          <span class="fill" style="width:{usedPct}%"></span>
        </span>
        <span class="muted"
          >{formatBytes(usage.usage)} of {formatBytes(usage.quota)} browser storage</span
        >
      {/if}
    </div>
    {#if takes.length > 1}
      <Button onclick={() => (confirmAll = true)}>Delete all</Button>
    {/if}
  </header>

  {#if error}<p class="msg" role="alert">{error}</p>{/if}

  {#if loaded && takes.length === 0}
    <div class="empty" role="status">
      <p>No saved takes yet.</p>
      <Button variant="primary" onclick={onrecord}>Go to Record</Button>
    </div>
  {:else}
    <ul class="list">
      {#each takes as t (t.id)}
        <li class="take" data-testid="take">
          <div class="info">
            {#if renaming === t.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="name-input"
                aria-label="Take name"
                bind:value={draft}
                autofocus
                maxlength="80"
                onkeydown={(e) => {
                  if (e.key === 'Enter') void commitRename()
                  else if (e.key === 'Escape') renaming = ''
                }}
                onblur={() => void commitRename()}
              />
            {:else}
              <span class="name">{sessionLabel(t)}</span>
            {/if}
            <span class="meta">
              {new Date(t.createdAt).toLocaleString()} · {formatTime(
                t.durationMs,
              )} · {formatBytes(t.sizeBytes)}
              · {summary(t)}
            </span>
          </div>
          <div class="actions">
            <Button variant="primary" onclick={() => onopen(t.id, 'compose')}
              >Open</Button
            >
            <Button onclick={() => onopen(t.id, 'export')}>Export</Button>
            <Button onclick={() => startRename(t)}>Rename</Button>
            <Button onclick={() => (toDelete = t)}>Delete</Button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<AlertDialog.Root
  open={toDelete !== null}
  onOpenChange={(o) => !o && (toDelete = null)}
>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="dlg-overlay" />
    <AlertDialog.Content class="dlg">
      <AlertDialog.Title class="dlg-title">Delete this take?</AlertDialog.Title>
      <AlertDialog.Description class="dlg-text">
        “{toDelete ? sessionLabel(toDelete) : ''}” and its recordings will be
        removed from this browser. This can't be undone.
      </AlertDialog.Description>
      <div class="dlg-actions">
        <AlertDialog.Cancel class="btn secondary">Cancel</AlertDialog.Cancel>
        <AlertDialog.Action
          class="btn danger"
          onclick={() => {
            const t = toDelete
            toDelete = null
            if (t) void remove([t.id])
          }}
        >
          Delete
        </AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>

<AlertDialog.Root open={confirmAll} onOpenChange={(o) => (confirmAll = o)}>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="dlg-overlay" />
    <AlertDialog.Content class="dlg">
      <AlertDialog.Title class="dlg-title">Delete all takes?</AlertDialog.Title>
      <AlertDialog.Description class="dlg-text">
        All {takes.length} takes and their recordings will be removed from this browser.
        This can't be undone.
      </AlertDialog.Description>
      <div class="dlg-actions">
        <AlertDialog.Cancel class="btn secondary">Cancel</AlertDialog.Cancel>
        <AlertDialog.Action
          class="btn danger"
          onclick={() => {
            confirmAll = false
            void remove(takes.map((t) => t.id))
          }}
        >
          Delete all
        </AlertDialog.Action>
      </div>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>

<style>
  .page {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-4);
    align-content: start;
    max-width: 60rem;
    width: 100%;
    margin: 0 auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .storage {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
    flex-wrap: wrap;
    font-size: var(--text-sm);
  }
  .muted {
    color: var(--ink-3);
  }
  .bar {
    width: 120px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .take {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
  }
  .info {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-weight: 600;
  }
  .meta {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .name-input {
    font: inherit;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent);
    background: var(--surface-0);
    color: var(--ink-1);
    min-width: 16rem;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .empty {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
    color: var(--ink-2);
  }
  .msg {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warn-bg);
    color: var(--warn-ink);
    font-size: var(--text-sm);
  }
  :global(.dlg-overlay) {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.5);
    z-index: 20;
  }
  :global(.dlg) {
    position: fixed;
    z-index: 21;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(92vw, 26rem);
    background: var(--surface-1);
    color: var(--ink-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    box-shadow: var(--shadow-pop);
    display: grid;
    gap: var(--space-3);
  }
  :global(.dlg-title) {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
  }
  :global(.dlg-text) {
    margin: 0;
    color: var(--ink-2);
  }
  .dlg-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
