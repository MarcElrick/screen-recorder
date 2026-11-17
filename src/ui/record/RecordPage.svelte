<script lang="ts">
  import { onMount } from 'svelte'
  import { bubblePlacement } from '../../engine'
  import Button from '../components/Button.svelte'
  import CornerPicker from '../components/CornerPicker.svelte'
  import SelectField from '../components/SelectField.svelte'
  import SliderField from '../components/SliderField.svelte'
  import SwitchField from '../components/SwitchField.svelte'
  import { activity } from '../activity.svelte'
  import { MIC_DEFAULT, MIC_OFF, RecorderStore } from './recorder.svelte'
  import { formatTime } from './format'
  import StreamVideo from './StreamVideo.svelte'

  let { active = true }: { active?: boolean } = $props()
  const r = new RecorderStore()
  onMount(() => void r.init())
  $effect(() => {
    activity.recording = r.busy
    return () => (activity.recording = false)
  })

  const bubble = $derived(bubblePlacement({ corner: r.corner, size: r.size }))
  const micOptions = $derived([
    { id: MIC_OFF, label: 'Off' },
    { id: MIC_DEFAULT, label: 'System default' },
    ...r.mics.filter((m) => m.id !== 'default'),
  ])
  const cameraHasVideo = $derived(
    (r.cameraStream?.getVideoTracks().length ?? 0) > 0,
  )
  const recording = $derived(r.phase === 'recording')
  const paused = $derived(r.phase === 'paused')
  const live = $derived(recording || paused)
  const canStart = $derived(
    r.phase === 'ready' || (r.phase === 'done' && r.session.hasCamera),
  )
  const sidebarLocked = $derived(r.busy)

  const status = $derived(
    r.phase === 'countdown'
      ? `Starting in ${r.countdownLeft}`
      : recording
        ? 'Recording'
        : paused
          ? 'Paused'
          : r.phase === 'stopping'
            ? 'Saving…'
            : r.phase === 'done'
              ? 'Saved'
              : 'Ready',
  )

  /** Alt+R starts or stops, Alt+P pauses or resumes. */
  function onkeydown(e: KeyboardEvent): void {
    if (!active || !e.altKey || e.ctrlKey || e.metaKey) return
    const key = e.code
    if (key === 'KeyR') {
      e.preventDefault()
      if (live) void r.stop()
      else if (r.phase === 'countdown') r.cancelCountdown()
      else if (canStart) void r.start()
    } else if (key === 'KeyP' && live) {
      e.preventDefault()
      if (paused) r.resume()
      else r.pause()
    }
  }

  function download(index: number): void {
    const t = r.output?.tracks[index]
    if (!t) return
    const url = URL.createObjectURL(t.blob)
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: t.file,
    })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
</script>

<svelte:window {onkeydown} />

{#if !r.supported}
  <div class="unsupported" role="alert">
    This browser can't record the screen. Please use a recent Chrome, Edge or
    Firefox on desktop.
  </div>
{:else}
  <div class="layout">
    <section class="stage" aria-label="Screen preview">
      <div class="frame">
        {#if r.screenStream}
          <StreamVideo stream={r.screenStream} label="Screen preview" />
        {:else if r.cameraStream && r.cameraOn && cameraHasVideo}
          <StreamVideo
            stream={r.cameraStream}
            label="Camera preview"
            mirror
            cover
          />
          <div class="camonly">
            <span>Camera only. Choose a screen to record it too.</span>
            <Button
              disabled={sidebarLocked}
              onclick={() => void r.chooseScreen()}
            >
              Choose screen
            </Button>
          </div>
        {:else}
          <div class="empty">
            <p>
              Choose a screen, window or tab to record, or turn on your camera.
            </p>
            <Button variant="primary" onclick={() => void r.chooseScreen()}
              >Choose screen</Button
            >
          </div>
        {/if}
        {#if r.screenStream && r.cameraStream && r.cameraOn}
          <div
            class="bubble"
            style="left:{bubble.x * 100}%;top:{bubble.y *
              100}%;width:{bubble.width * 100}%;aspect-ratio:1"
          >
            <StreamVideo
              stream={r.cameraStream}
              label="Camera preview"
              mirror
              cover
            />
          </div>
        {/if}
        {#if r.phase === 'countdown'}
          <div class="countdown" aria-hidden="true">
            {r.countdownLeft || ''}
          </div>
        {/if}
      </div>
      <p class="hint">
        The bubble is a preview. You can move it freely in Compose.
      </p>
    </section>

    <aside class="sidebar" aria-label="Sources">
      <h2>Sources</h2>
      <div class="group">
        <span class="label">Screen</span>
        <Button disabled={sidebarLocked} onclick={() => void r.chooseScreen()}>
          {r.screenStream ? 'Change…' : 'Choose…'}
        </Button>
      </div>
      <SwitchField
        label="Camera"
        bind:checked={r.cameraOn}
        disabled={sidebarLocked}
      />
      <SelectField
        label="Camera device"
        value={r.cameraId}
        options={r.cameras}
        disabled={sidebarLocked || !r.cameraOn}
        onchange={(v) => {
          r.cameraId = v
          void r.refreshCamera()
        }}
      />
      <SelectField
        label="Microphone"
        value={r.micId}
        options={micOptions}
        disabled={sidebarLocked}
        placeholder="Off"
        onchange={(v) => {
          r.micId = v
          void r.refreshCamera()
        }}
      />
      <div
        class="meter"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(r.level * 100)}
      >
        <div class="meter-fill" style="width:{r.level * 100}%"></div>
      </div>
      <CornerPicker bind:value={r.corner} />
      <SliderField label="Bubble size" bind:value={r.size} />
    </aside>

    <footer class="controls">
      <div class="rec" class:on={recording} aria-live="polite">
        <span class="dot" class:on={recording}></span>
        <span class="status">{status}</span>
        <span class="timer">{formatTime(r.elapsedMs)}</span>
      </div>
      <div class="buttons">
        {#if r.phase === 'countdown'}
          <Button onclick={() => r.cancelCountdown()}>Cancel</Button>
        {:else if live}
          {#if paused}
            <Button onclick={() => r.resume()}>Resume</Button>
          {:else}
            <Button onclick={() => r.pause()}>Pause</Button>
          {/if}
          <Button variant="danger" onclick={() => void r.stop()}>Stop</Button>
        {:else}
          <Button
            variant="primary"
            disabled={!canStart}
            onclick={() => void r.start()}
          >
            Start recording
          </Button>
        {/if}
      </div>
      <div class="opts">
        <SwitchField
          label="3s countdown"
          bind:checked={r.countdown}
          disabled={sidebarLocked}
        />
        <span class="hint">Alt+R start/stop · Alt+P pause</span>
      </div>
    </footer>

    <div class="messages" aria-live="polite">
      {#if r.message}<p class="msg">{r.message}</p>{/if}
      {#if r.session.error}<p class="msg">{r.session.error}</p>{/if}
      {#each r.session.notices as n (n)}<p class="msg">{n}</p>{/each}
      {#if r.phase === 'done' && r.output}
        <p class="msg ok">
          Take saved ({formatTime(r.output.manifest.durationMs)}).
          {#each r.output.tracks as t, i (t.file)}
            <button class="link" onclick={() => download(i)}
              >Download {t.kind}.webm</button
            >
          {/each}
          <button class="link" onclick={() => r.newTake()}>New take</button>
        </p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr 280px;
    grid-template-rows: 1fr auto;
    gap: var(--space-4);
    padding: var(--space-4);
    min-height: 0;
    flex: 1;
    position: relative;
  }
  .stage {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .frame {
    position: relative;
    flex: 1;
    min-height: 240px;
    background: var(--surface-stage);
    border-radius: var(--radius-md);
    overflow: hidden;
    aspect-ratio: 16 / 9;
    max-height: calc(100vh - 220px);
    width: 100%;
    align-self: center;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-3);
    color: #c4c7d2;
  }
  .bubble {
    position: absolute;
    border-radius: var(--radius-full);
    overflow: hidden;
    border: 3px solid #fff;
    box-shadow: var(--shadow-pop);
    transition:
      left var(--dur),
      top var(--dur),
      width var(--dur);
  }
  .camonly {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: rgb(0 0 0 / 0.55);
    color: #fff;
    font-size: var(--text-sm);
  }
  .countdown {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    font-size: 8rem;
    font-weight: 700;
    color: #fff;
    background: rgb(0 0 0 / 0.45);
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-3);
  }
  .sidebar {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-4);
    align-content: start;
    overflow: auto;
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .group {
    display: grid;
    gap: var(--space-1);
  }
  .label {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .meter {
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    overflow: hidden;
  }
  .meter-fill {
    height: 100%;
    background: var(--ok);
    transition: width 60ms linear;
  }
  .controls {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
  }
  .rec {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 200px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-full);
    background: var(--ink-3);
  }
  .dot.on {
    background: var(--rec);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  .timer {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-lg);
  }
  .status {
    color: var(--ink-2);
    font-size: var(--text-sm);
  }
  .buttons {
    display: flex;
    gap: var(--space-2);
  }
  .opts {
    min-width: 200px;
    display: flex;
    justify-content: flex-end;
  }
  .opts :global(.row) {
    gap: var(--space-3);
  }
  .messages {
    grid-column: 1 / -1;
    display: grid;
    gap: var(--space-2);
  }
  .msg {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warn-bg);
    color: var(--warn-ink);
    font-size: var(--text-sm);
  }
  .msg.ok {
    background: var(--surface-2);
    color: var(--ink-1);
  }
  .link {
    font: inherit;
    background: none;
    border: 0;
    padding: 0 var(--space-2);
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }
  .unsupported {
    margin: var(--space-5);
    padding: var(--space-4);
    background: var(--warn-bg);
    color: var(--warn-ink);
    border-radius: var(--radius-md);
  }
  @media (max-width: 800px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .controls {
      flex-wrap: wrap;
    }
  }
</style>
