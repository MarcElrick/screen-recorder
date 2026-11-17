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
    hidden
  ></video>
  {#if store.cameraUrl}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={cameraEl}
      src={store.cameraUrl}
      playsinline
      preload="auto"
      hidden
    ></video>
  {/if}
  {#if store.hasCameraVideo && store.cameraUrl}
    <BubbleOverlay {store} />
  {/if}
</div>

<style>
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
