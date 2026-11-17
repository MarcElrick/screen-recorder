<script lang="ts">
  import { ToggleGroup } from 'bits-ui'
  import type { BubbleShape } from '../../engine'

  let { value = $bindable<BubbleShape>('circle') }: { value?: BubbleShape } =
    $props()
</script>

<div class="field">
  <span class="label">Bubble shape</span>
  <ToggleGroup.Root
    type="single"
    {value}
    onValueChange={(v) => {
      if (v) value = v as BubbleShape
    }}
    class="shapes"
    aria-label="Bubble shape"
  >
    <ToggleGroup.Item value="circle" class="shape">Circle</ToggleGroup.Item>
    <ToggleGroup.Item value="rounded" class="shape">Rounded</ToggleGroup.Item>
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
  :global(.shapes) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
  }
  :global(.shape) {
    font: inherit;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--ink-2);
    cursor: pointer;
  }
  :global(.shape[data-state='on']) {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: transparent;
  }
</style>
