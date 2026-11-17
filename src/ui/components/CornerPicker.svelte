<script lang="ts">
  import { ToggleGroup } from 'bits-ui'
  import type { Corner } from '../../engine'

  let { value = $bindable<Corner>('bottom-right') }: { value?: Corner } =
    $props()

  const corners: { id: Corner; label: string; glyph: string }[] = [
    { id: 'top-left', label: 'Top left', glyph: '◤' },
    { id: 'top-right', label: 'Top right', glyph: '◥' },
    { id: 'bottom-left', label: 'Bottom left', glyph: '◣' },
    { id: 'bottom-right', label: 'Bottom right', glyph: '◢' },
  ]
</script>

<div class="field">
  <span class="label">Bubble corner</span>
  <ToggleGroup.Root
    type="single"
    {value}
    onValueChange={(v) => {
      if (v) value = v as Corner
    }}
    class="corners"
    aria-label="Bubble corner"
  >
    {#each corners as c (c.id)}
      <ToggleGroup.Item value={c.id} class="corner" aria-label={c.label}>
        <span aria-hidden="true">{c.glyph}</span>
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
</div>

<style>
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .label {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  :global(.corners) {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-1);
  }
  :global(.corner) {
    font: inherit;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--ink-2);
    cursor: pointer;
  }
  :global(.corner[data-state='on']) {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: transparent;
  }
</style>
