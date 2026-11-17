<script lang="ts">
  import { Select } from 'bits-ui'

  let {
    label,
    value = $bindable(''),
    options,
    disabled = false,
    placeholder = 'Default',
    onchange,
  }: {
    label: string
    value?: string
    options: { id: string; label: string }[]
    disabled?: boolean
    placeholder?: string
    onchange?: (v: string) => void
  } = $props()

  const items = $derived(options.map((o) => ({ value: o.id, label: o.label })))
  const current = $derived(
    options.find((o) => o.id === value)?.label ?? placeholder,
  )
</script>

<div class="field">
  <span class="label">{label}</span>
  <Select.Root
    type="single"
    {items}
    {disabled}
    {value}
    onValueChange={(v) => {
      value = v
      onchange?.(v)
    }}
  >
    <Select.Trigger class="sel-trigger" aria-label={label}>
      <span class="sel-text">{current}</span>
      <span aria-hidden="true">▾</span>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content class="sel-content" sideOffset={4}>
        <Select.Viewport>
          {#each items as item (item.value)}
            <Select.Item class="sel-item" value={item.value} label={item.label}>
              {item.label}
            </Select.Item>
          {/each}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
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
  :global(.sel-trigger) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    font: inherit;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--ink-1);
    cursor: pointer;
    width: 100%;
  }
  :global(.sel-trigger[data-disabled]) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sel-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.sel-content) {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
    padding: var(--space-1);
    min-width: var(--bits-select-anchor-width);
    z-index: 10;
  }
  :global(.sel-item) {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  :global(.sel-item[data-highlighted]) {
    background: var(--surface-2);
  }
  :global(.sel-item[data-selected]) {
    color: var(--accent);
    font-weight: 600;
  }
</style>
