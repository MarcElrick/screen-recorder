<script lang="ts">
  import { Slider } from 'bits-ui'

  let {
    label,
    value = $bindable(0.2),
    min = 0.1,
    max = 0.5,
    step = 0.01,
    onchange,
  }: {
    label: string
    value?: number
    min?: number
    max?: number
    step?: number
    onchange?: (v: number) => void
  } = $props()
</script>

<div class="field">
  <span class="label">{label}</span>
  <Slider.Root
    type="single"
    bind:value
    {min}
    {max}
    {step}
    class="slider"
    onValueChange={(v) => onchange?.(v)}
  >
    <span class="track"><Slider.Range class="range" /></span>
    <Slider.Thumb index={0} class="knob" aria-label={label} />
  </Slider.Root>
</div>

<style>
  .field {
    display: grid;
    gap: var(--space-2);
  }
  .label {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  :global(.slider) {
    position: relative;
    display: flex;
    align-items: center;
    height: 20px;
    touch-action: none;
  }
  .track {
    position: relative;
    flex: 1;
    height: 4px;
    border-radius: var(--radius-full);
    background: var(--border);
    overflow: hidden;
  }
  :global(.range) {
    position: absolute;
    height: 100%;
    background: var(--accent);
  }
  :global(.knob) {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    background: var(--surface-1);
    border: 2px solid var(--accent);
    cursor: grab;
  }
</style>
