<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Progress, ToggleGroup } from 'bits-ui'
  import {
    ExportError,
    PRESETS,
    estimateBytes,
    exportSupported,
    exportVideo,
    formatBytes,
    listSessions,
    sessionLabel,
    type SessionSummary,
    loadSession,
    readCompose,
    type ExportFormat,
    type ExportResult,
    type ExportSettings,
    type Fps,
    type Quality,
  } from '../../engine'
  import Button from '../components/Button.svelte'
  import SelectField from '../components/SelectField.svelte'
  import SliderField from '../components/SliderField.svelte'
  import SwitchField from '../components/SwitchField.svelte'
  import { formatTime } from '../record/format'

  let {
    onrecord,
    takeId: preferred,
  }: { onrecord: () => void; takeId?: string } = $props()

  const supported = exportSupported()
  let sessions = $state<SessionSummary[]>([])
  let takeId = $state('')
  let hasAudio = $state(true)
  let settings = $state<ExportSettings>(structuredClone(PRESETS[0].settings))
  let progress = $state(0)
  let running = $state(false)
  let error = $state('')
  let result = $state<ExportResult | null>(null)
  let url = $state('')
  let abort: AbortController | null = null
  let loaded = $state(false)

  const heights = [
    { id: '2160', label: '4K (2160p)' },
    { id: '1080', label: '1080p' },
    { id: '720', label: '720p' },
  ]
  const fpsOptions = [
    { id: '24', label: '24 fps' },
    { id: '30', label: '30 fps' },
    { id: '60', label: '60 fps' },
  ]
  const qualities: { id: Quality; label: string }[] = [
    { id: 'small', label: 'Small' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'high', label: 'High' },
  ]
  const takeOptions = $derived(
    sessions.map((s) => ({
      id: s.id,
      label: `${sessionLabel(s)} (${formatTime(s.durationMs)})`,
    })),
  )
  const take = $derived(sessions.find((s) => s.id === takeId))

  const same = (a: ExportSettings, b: ExportSettings): boolean =>
    a.format === b.format &&
    a.maxHeight === b.maxHeight &&
    a.fps === b.fps &&
    a.quality === b.quality &&
    a.audio.mute === b.audio.mute &&
    a.audio.normalise === b.audio.normalise &&
    a.audio.gain === b.audio.gain
  const preset = $derived(
    PRESETS.find((p) => same(p.settings, settings))?.id ?? '',
  )
  const estimate = $derived(
    take
      ? formatBytes(estimateBytes(settings, take.durationMs, 16 / 9, hasAudio))
      : '',
  )
  const volumePct = $derived(Math.round(settings.audio.gain * 100))

  onMount(async () => {
    try {
      sessions = await listSessions()
      takeId =
        sessions.find((s) => s.id === preferred)?.id ?? sessions[0]?.id ?? ''
      await loadTakeInfo()
    } finally {
      loaded = true
    }
  })
  onDestroy(() => {
    abort?.abort()
    if (url) URL.revokeObjectURL(url)
  })

  async function loadTakeInfo(): Promise<void> {
    if (!takeId) return
    try {
      const s = await loadSession(takeId)
      hasAudio = s.manifest.tracks.some(
        (t) => t.kind === 'camera' && t.hasAudio,
      )
    } catch {
      hasAudio = false
    }
  }

  function clearResult(): void {
    if (url) URL.revokeObjectURL(url)
    url = ''
    result = null
  }

  function change(fn: () => void): void {
    fn()
    clearResult()
  }

  function applyPreset(id: string): void {
    const p = PRESETS.find((x) => x.id === id)
    if (p) change(() => (settings = structuredClone(p.settings)))
  }

  async function start(): Promise<void> {
    if (!takeId || running) return
    clearResult()
    error = ''
    progress = 0
    running = true
    abort = new AbortController()
    try {
      const s = await loadSession(takeId)
      const compose = readCompose(s.manifest)
      result = await exportVideo({
        manifest: s.manifest,
        edit: compose.edit,
        screen: s.screen!,
        camera: s.camera,
        layout: compose.bubble,
        format: settings.format,
        maxHeight: settings.maxHeight,
        fps: settings.fps,
        quality: settings.quality,
        audio: { ...settings.audio },
        onProgress: (p) => (progress = p),
        signal: abort.signal,
      })
      url = URL.createObjectURL(result.blob)
    } catch (e) {
      error =
        e instanceof ExportError
          ? e.message
          : `Export failed: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      running = false
      abort = null
    }
  }

  const sizeMb = $derived(
    result ? (result.blob.size / 1024 / 1024).toFixed(1) : '',
  )
</script>

{#if !supported}
  <div class="state" role="alert">
    <p>
      This browser can't encode video. Please use a recent Chrome, Edge or
      Safari.
    </p>
  </div>
{:else if loaded && sessions.length === 0}
  <div class="state" role="status">
    <p>No recordings yet. Record a take first.</p>
    <Button variant="primary" onclick={onrecord}>Go to Record</Button>
  </div>
{:else}
  <div class="page">
    <section class="card" aria-label="Export settings">
      <h2>Export</h2>
      <SelectField
        label="Take"
        value={takeId}
        options={takeOptions}
        disabled={running}
        placeholder="Choose a take"
        onchange={(v) => {
          takeId = v
          clearResult()
          void loadTakeInfo()
        }}
      />
      <div class="field">
        <span class="label">Preset</span>
        <ToggleGroup.Root
          type="single"
          value={preset}
          disabled={running}
          onValueChange={(v) => v && applyPreset(v)}
          class="presets"
          aria-label="Preset"
        >
          {#each PRESETS as p (p.id)}
            <ToggleGroup.Item value={p.id} class="preset">
              <span class="p-name">{p.label}</span>
              <span class="p-hint">{p.hint}</span>
            </ToggleGroup.Item>
          {/each}
        </ToggleGroup.Root>
        {#if !preset}<span class="hint">Custom settings</span>{/if}
      </div>
      <div class="field">
        <span class="label">Format</span>
        <ToggleGroup.Root
          type="single"
          value={settings.format}
          disabled={running}
          onValueChange={(v) =>
            v && change(() => (settings.format = v as ExportFormat))}
          class="seg"
          aria-label="Format"
        >
          <ToggleGroup.Item value="mp4" class="fmt">MP4</ToggleGroup.Item>
          <ToggleGroup.Item value="webm" class="fmt">WebM</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
      <SelectField
        label="Maximum resolution"
        value={String(settings.maxHeight)}
        options={heights}
        disabled={running}
        onchange={(v) => change(() => (settings.maxHeight = Number(v)))}
      />
      <SelectField
        label="Frame rate"
        value={String(settings.fps)}
        options={fpsOptions}
        disabled={running}
        onchange={(v) => change(() => (settings.fps = Number(v) as Fps))}
      />
      <div class="field">
        <span class="label">Quality</span>
        <ToggleGroup.Root
          type="single"
          value={settings.quality}
          disabled={running}
          onValueChange={(v) =>
            v && change(() => (settings.quality = v as Quality))}
          class="seg3"
          aria-label="Quality"
        >
          {#each qualities as q (q.id)}
            <ToggleGroup.Item value={q.id} class="fmt"
              >{q.label}</ToggleGroup.Item
            >
          {/each}
        </ToggleGroup.Root>
      </div>
      <fieldset class="audio" disabled={running}>
        <legend class="label">Audio</legend>
        {#if hasAudio}
          <SwitchField
            label="Mute"
            checked={settings.audio.mute}
            disabled={running}
            onchange={(v) => change(() => (settings.audio.mute = v))}
          />
          <SwitchField
            label="Normalise volume"
            checked={settings.audio.normalise}
            disabled={running || settings.audio.mute}
            onchange={(v) => change(() => (settings.audio.normalise = v))}
          />
          <SliderField
            label={`Volume ${volumePct}%`}
            value={settings.audio.gain}
            min={0.5}
            max={2}
            step={0.05}
            onchange={(v) => change(() => (settings.audio.gain = v))}
          />
        {:else}
          <p class="hint">This take has no microphone audio.</p>
        {/if}
      </fieldset>
      {#if estimate}
        <p class="estimate" aria-live="polite">
          Estimated size: about {estimate}
        </p>
      {/if}
      <div class="actions">
        {#if running}
          <Button onclick={() => abort?.abort()}>Cancel</Button>
        {:else}
          <Button
            variant="primary"
            disabled={!takeId}
            onclick={() => void start()}
          >
            Export
          </Button>
        {/if}
      </div>
      {#if running}
        <div class="progress">
          <Progress.Root
            value={Math.round(progress * 100)}
            max={100}
            class="bar"
            aria-label="Export progress"
          >
            <div class="fill" style="width:{progress * 100}%"></div>
          </Progress.Root>
          <span class="pct" aria-live="polite"
            >{Math.round(progress * 100)}%</span
          >
        </div>
      {/if}
      {#if error}<p class="msg" role="alert">{error}</p>{/if}
    </section>

    <section class="card result" aria-label="Result">
      {#if result}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={url} controls playsinline aria-label="Exported video"
        ></video>
        <p class="meta">
          {result.width}×{result.height}, {formatTime(result.durationMs)}, {sizeMb}
          MB ·
          {result.videoCodec}{result.audioCodec
            ? ` + ${result.audioCodec}`
            : ', no audio'}
        </p>
        {#if settings.format === 'mp4' && result.videoCodec !== 'avc'}
          <p class="msg">
            This browser can't encode H.264, so the MP4 uses {result.videoCodec}.
            It plays in modern browsers, but some older players may not support
            it.
          </p>
        {/if}
        <a
          class="download"
          href={url}
          download={`recording.${result.extension}`}
        >
          Download recording.{result.extension}
        </a>
      {:else}
        <p class="hint">Your exported video will appear here.</p>
      {/if}
    </section>
  </div>
{/if}

<style>
  .page {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: var(--space-4);
    padding: var(--space-4);
    align-items: start;
  }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .field {
    display: grid;
    gap: var(--space-1);
  }
  .label {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  :global(.seg) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
  }
  :global(.seg3) {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-1);
  }
  :global(.presets) {
    display: grid;
    gap: var(--space-1);
  }
  :global(.preset) {
    font: inherit;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--ink-1);
    cursor: pointer;
    display: grid;
  }
  :global(.preset[data-state='on']) {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .p-name {
    font-weight: 600;
  }
  .p-hint {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  .audio {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-3);
  }
  .estimate {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-2);
  }
  :global(.fmt) {
    font: inherit;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--ink-2);
    cursor: pointer;
  }
  :global(.fmt[data-state='on']) {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: transparent;
  }
  .progress {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  :global(.bar) {
    flex: 1;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 100ms linear;
  }
  .pct {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    min-width: 3ch;
    text-align: right;
  }
  .result video {
    width: 100%;
    border-radius: var(--radius-sm);
    background: var(--surface-stage);
  }
  .meta,
  .hint {
    margin: 0;
    color: var(--ink-2);
    font-size: var(--text-sm);
  }
  .msg {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warn-bg);
    color: var(--warn-ink);
    font-size: var(--text-sm);
  }
  .download {
    justify-self: start;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-ink);
    text-decoration: none;
  }
  .state {
    margin: var(--space-5);
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }
  @media (max-width: 800px) {
    .page {
      grid-template-columns: 1fr;
    }
  }
</style>
