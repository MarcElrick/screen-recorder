<script lang="ts">
  import { Button } from 'bits-ui'
  import type { Snippet } from 'svelte'

  let {
    variant = 'secondary',
    children,
    ...rest
  }: {
    variant?: 'primary' | 'secondary' | 'danger'
    children: Snippet
    onclick?: () => void
    disabled?: boolean
    'aria-label'?: string
  } = $props()
</script>

<Button.Root class="btn {variant}" {...rest}>{@render children()}</Button.Root>

<style>
  :global(.btn) {
    font: inherit;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--ink-1);
    cursor: pointer;
    transition: filter var(--dur);
  }
  :global(.btn:hover:not([disabled])) {
    filter: brightness(0.95);
  }
  :global(.btn[disabled]) {
    opacity: 0.45;
    cursor: not-allowed;
  }
  :global(.btn.primary) {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: transparent;
  }
  :global(.btn.danger) {
    background: var(--rec);
    color: #fff;
    border-color: transparent;
  }
</style>
