<script lang="ts">
  import { onMount } from 'svelte'
  import {
    discardUnfinished,
    findUnfinished,
    formatBytes,
    recoverTake,
    type UnfinishedTake,
  } from '../../engine'
  import Button from '../components/Button.svelte'

  let { onrecovered }: { onrecovered: (id: string) => void } = $props()

  let found = $state<UnfinishedTake[]>([])
  let busy = $state('')
  let error = $state('')

  onMount(async () => {
    try {
      found = await findUnfinished()
    } catch {
      found = []
    }
  })

  async function recover(t: UnfinishedTake): Promise<void> {
    busy = t.id
    error = ''
    try {
      await recoverTake(t.id)
      found = found.filter((x) => x.id !== t.id)
      onrecovered(t.id)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not recover that take.'
    } finally {
      busy = ''
    }
  }

  async function discard(t: UnfinishedTake): Promise<void> {
    busy = t.id
    try {
      await discardUnfinished(t.id)
      found = found.filter((x) => x.id !== t.id)
    } catch {
      error = 'Could not discard that take.'
    } finally {
      busy = ''
    }
  }
</script>

{#if found.length}
  <div class="banner" role="region" aria-label="Unfinished recording">
    {#each found as t (t.id)}
      <div class="row">
        <span>
          A recording from {new Date(t.startedAt).toLocaleString()} ({formatBytes(
            t.sizeBytes,
          )}) didn't finish. Recover what was saved?
        </span>
        <span class="actions">
          <Button
            variant="primary"
            disabled={busy === t.id}
            onclick={() => void recover(t)}
          >
            Recover
          </Button>
          <Button disabled={busy === t.id} onclick={() => void discard(t)}
            >Discard</Button
          >
        </span>
      </div>
    {/each}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  .banner {
    background: var(--warn-bg);
    color: var(--warn-ink);
    padding: var(--space-2) var(--space-4);
    display: grid;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
  .err {
    margin: 0;
  }
</style>
