<script lang="ts">
  import { cueAt } from '../../engine'
  import Button from '../components/Button.svelte'
  import SelectField from '../components/SelectField.svelte'
  import SwitchField from '../components/SwitchField.svelte'
  import { formatTime } from '../record/format'
  import type { ComposeStore } from './compose.svelte'

  let { store }: { store: ComposeStore } = $props()

  const style = $derived(store.captionStyle)
  const activeKey = $derived(cueAt(store.cues, store.playhead)?.key)
</script>

{#if style}
  <div class="panel">
    <div class="group" role="group" aria-label="Caption style">
      <SwitchField
        label="Show captions"
        checked={style.enabled}
        onchange={(v) => store.setCaptionStyle({ enabled: v })}
      />
      <SelectField
        label="Size"
        value={style.size}
        options={[
          { id: 'small', label: 'Small' },
          { id: 'medium', label: 'Medium' },
          { id: 'large', label: 'Large' },
        ]}
        onchange={(v) =>
          store.setCaptionStyle({ size: v as 'small' | 'medium' | 'large' })}
      />
      <SelectField
        label="Position"
        value={style.position}
        options={[
          { id: 'bottom', label: 'Bottom' },
          { id: 'top', label: 'Top' },
        ]}
        onchange={(v) =>
          store.setCaptionStyle({ position: v as 'top' | 'bottom' })}
      />
      <SwitchField
        label="Dark background"
        checked={style.background}
        onchange={(v) => store.setCaptionStyle({ background: v })}
      />
    </div>
    <p class="hint">
      Edit what each caption says. This changes the captions only; the words and
      what gets cut stay as they are. Press Enter for a new line.
    </p>
    <div class="actions">
      <Button
        disabled={!store.transcript?.captionLayout}
        onclick={() => store.resetCaptionEdits()}
      >
        Reset captions
      </Button>
    </div>
    <ol class="cues" data-testid="cues">
      {#each store.cues as c (c.key)}
        <li class="cue" class:active={c.key === activeKey}>
          <button
            type="button"
            class="cue-time"
            title="Jump to this caption"
            onclick={() => store.seekCue(c.startMs)}
          >
            {formatTime(c.startMs)}
          </button>
          <textarea
            class="cue-text"
            aria-label={`Caption at ${formatTime(c.startMs)}`}
            rows={Math.max(2, c.text.split('\n').length)}
            value={c.text}
            onchange={(e) => store.setCueText(c.key!, e.currentTarget.value)}
          ></textarea>
          <div class="cue-actions">
            {#if c.custom}
              <Button onclick={() => store.resetCueText(c.key!)}>
                Use spoken words
              </Button>
            {/if}
            {#if c.key !== store.words[0]?.id}
              <Button onclick={() => store.joinCue(c.key!)}>
                Join with previous
              </Button>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  .panel {
    display: grid;
    gap: var(--space-3);
    align-content: start;
  }
  .group {
    display: grid;
    gap: var(--space-3);
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-3);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .cues {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .cue {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-0);
  }
  .cue.active {
    border-color: var(--accent);
  }
  .cue-time {
    justify-self: start;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--ink-2);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .cue-text {
    font: inherit;
    resize: vertical;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--ink-1);
  }
  .cue-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
</style>
