<script lang="ts">
  import { Switch } from 'bits-ui'

  let {
    label,
    checked = $bindable(false),
    disabled = false,
    onchange,
  }: {
    label: string
    checked?: boolean
    disabled?: boolean
    onchange?: (v: boolean) => void
  } = $props()
</script>

<label class="row">
  <span>{label}</span>
  <Switch.Root
    class="switch"
    bind:checked
    {disabled}
    aria-label={label}
    onCheckedChange={(v) => onchange?.(v)}
  >
    <Switch.Thumb class="thumb" />
  </Switch.Root>
</label>

<style>
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  :global(.switch) {
    width: 40px;
    height: 22px;
    border-radius: var(--radius-full);
    border: 0;
    padding: 2px;
    background: var(--border);
    cursor: pointer;
    transition: background var(--dur);
  }
  :global(.switch[data-state='checked']) {
    background: var(--accent);
  }
  :global(.switch[data-disabled]) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :global(.switch .thumb) {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    background: #fff;
    transition: transform var(--dur);
  }
  :global(.switch[data-state='checked'] .thumb) {
    transform: translateX(18px);
  }
</style>
