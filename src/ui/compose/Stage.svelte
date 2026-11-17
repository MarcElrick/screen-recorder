<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import BubbleOverlay from './BubbleOverlay.svelte'
  import type { ComposeStore } from './compose.svelte'

  let { store }: { store: ComposeStore } = $props()

  let screenEl: HTMLVideoElement
  let cameraEl: HTMLVideoElement | undefined = $state()
  let canvas: HTMLCanvasElement

  onMount(() => store.attach(screenEl, cameraEl ?? null, canvas))
  onDestroy(() => store.detach())
</script>

<div class="frame" style="--aspect:{store.aspect}">
  <canvas bind:this={canvas} aria-label="Composed preview"></canvas>
  <video
    bind:this={screenEl}
    src={store.screenUrl}
    muted
    playsinline
    preload="auto"
    class="source"
  ></video>
  {#if store.cameraUrl}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={cameraEl}
      src={store.cameraUrl}
      playsinline
      preload="auto"
      class="source"
    ></video>
  {/if}
  {#if store.hasCameraVideo && store.cameraUrl}
    <BubbleOverlay {store} />
  {/if}
</div>

<style>
  /* Not display:none: some browsers (Firefox) won't present frames for those. */
  .source {
    position: absolute;
    left: 0;
    top: 0;
    width: 2px;
    height: 2px;
    opacity: 0;
    pointer-events: none;
  }
  .frame {
    position: relative;
    width: min(100cqw, 100cqh * var(--aspect));
    aspect-ratio: var(--aspect);
    background: var(--surface-stage);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
