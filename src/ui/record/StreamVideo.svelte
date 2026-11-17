<script lang="ts">
  let {
    stream,
    label,
    mirror = false,
    cover = false,
  }: {
    stream: MediaStream | null
    label: string
    mirror?: boolean
    cover?: boolean
  } = $props()

  function attach(node: HTMLVideoElement, s: MediaStream | null) {
    node.srcObject = s
    return {
      update(next: MediaStream | null) {
        node.srcObject = next
      },
    }
  }
</script>

<video
  use:attach={stream}
  autoplay
  muted
  playsinline
  aria-label={label}
  class:mirror
  class:cover
></video>

<style>
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  video.cover {
    object-fit: cover;
  }
  video.mirror {
    transform: scaleX(-1);
  }
</style>
