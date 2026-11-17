<script lang="ts">
  import { tick } from 'svelte'
  import Button from '../components/Button.svelte'
  import type { ComposeStore } from './compose.svelte'

  let { store }: { store: ComposeStore } = $props()

  let editing = $state(-1)
  let draft = $state('')

  const sel = $derived(store.selectedWords)
  const selCount = $derived(sel ? sel.to - sel.from + 1 : 0)
  const allDeleted = $derived(
    selCount > 0 && store.selectedIds.every((id) => store.deleted.has(id)),
  )

  function startEdit(i: number): void {
    editing = i
    draft = store.wordText(store.words[i])
  }
  function finishEdit(save: boolean): void {
    if (editing >= 0 && save) store.setWordText(store.words[editing].id, draft)
    editing = -1
  }

  function onkeydown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).closest('input')) return
    const cur = store.selectedWords
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      store.toggleSelectedWords()
    } else if (e.key === 'Enter' && cur && cur.from === cur.to) {
      e.preventDefault()
      startEdit(cur.from)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && cur) {
      e.preventDefault()
      const d = e.key === 'ArrowRight' ? 1 : -1
      const max = store.words.length - 1
      const to = Math.min(max, Math.max(0, (d > 0 ? cur.to : cur.from) + d))
      if (e.shiftKey) {
        // Grow or shrink from the end the arrow points at.
        const anchor = d > 0 ? cur.from : cur.to
        store.clickWord(anchor, false)
        store.clickWord(to, true)
      } else store.clickWord(to, false)
      void tick().then(() =>
        document.querySelector<HTMLElement>(`[data-word="${to}"]`)?.focus(),
      )
    }
  }

  $effect(() => {
    // Keep the playing word in view.
    const i = store.activeWord
    if (store.playing && i >= 0)
      void tick().then(() =>
        document
          .querySelector(`[data-word="${i}"]`)
          ?.scrollIntoView({ block: 'nearest' }),
      )
  })
</script>

<div class="panel">
  <div class="actions">
    <Button disabled={!selCount} onclick={() => store.toggleSelectedWords()}>
      {allDeleted ? 'Restore words' : 'Delete words'}
    </Button>
    <Button
      disabled={!store.canStartCaption}
      onclick={() => store.startCaptionAtSelection()}
    >
      New caption here
    </Button>
    <Button
      disabled={!store.canJoinCaption}
      onclick={() => store.joinSelectedCaption()}
    >
      Join with previous caption
    </Button>
  </div>
  <p class="hint">
    Click a word to jump to it and select it on the timeline. Shift+click or
    drag on the timeline to select more, Delete to remove, Enter to fix the
    spelling. A bar marks where each caption starts.
  </p>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <p class="words" data-testid="transcript" {onkeydown}>
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
        {@const status = store.statusOf(w)}
        <button
          type="button"
          class="word"
          class:deleted={status === 'deleted'}
          class:cut={status === 'cut'}
          class:cue-start={i > 0 && store.starts.has(w.id)}
          class:active={i === store.activeWord}
          class:selected={sel !== null && i >= sel.from && i <= sel.to}
          data-word={i}
          data-status={status}
          aria-pressed={status === 'deleted'}
          title={status === 'cut' ? 'Already cut on the timeline' : undefined}
          onclick={(e) => store.clickWord(i, e.shiftKey)}
          ondblclick={() => startEdit(i)}
        >
          {store.wordText(w)}
        </button>
      {/if}
    {/each}
  </p>

  <h3>Clean up</h3>
  {#if store.fillers.length}
    <p class="hint">Filler words found (when the model kept them):</p>
    <div class="actions">
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
      disabled={store.deleted.size === 0 &&
        (store.transcript?.silenceCuts.length ?? 0) === 0}
      onclick={() => store.restoreAll()}
    >
      Restore all words
    </Button>
  </div>

  <h3>Word timing</h3>
  <p class="hint">
    If cuts clip a word, nudge every word earlier or later and replay.
    {#if store.transcript?.shiftMs}
      Shifted {store.transcript.shiftMs > 0 ? '+' : ''}{store.transcript
        .shiftMs}
      ms.
    {/if}
  </p>
  <div class="actions">
    <Button onclick={() => store.shiftWords(-20)}>Earlier 20 ms</Button>
    <Button onclick={() => store.shiftWords(20)}>Later 20 ms</Button>
  </div>
</div>

<style>
  .panel {
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }
  h3 {
    margin: var(--space-2) 0 0;
    font-size: var(--text-md);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-3);
  }
  .words {
    margin: 0;
    padding: var(--space-3);
    max-height: 340px;
    overflow: auto;
    line-height: 2;
    font-size: var(--text-md);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-0);
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
  .word.cue-start {
    border-left: 2px solid var(--accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
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
</style>
