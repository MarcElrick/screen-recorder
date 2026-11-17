<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Progress, ToggleGroup } from 'bits-ui'
  import {
    ExportError,
    exportSupported,
    exportVideo,
    listSessions,
    loadSession,
    readCompose,
    type ExportFormat,
    type ExportResult,
  } from '../../engine'
  import Button from '../components/Button.svelte'
  import SelectField from '../components/SelectField.svelte'
  import { formatTime } from '../record/format'

  let { onrecord }: { onrecord: () => void } = $props()

  const supported = exportSupported()
  let sessions = $state<
    { id: string; createdAt: string; durationMs: number }[]
  >([])
  let takeId = $state('')
  let format = $state<ExportFormat>('mp4')
  let height = $state('1080')
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
  const takeOptions = $derived(
    sessions.map((s) => ({
      id: s.id,
      label: `${new Date(s.createdAt).toLocaleString()} (${formatTime(s.durationMs)})`,
    })),
  )

  onMount(async () => {
    try {
      sessions = await listSessions()
      takeId = sessions[0]?.id ?? ''
    } finally {
      loaded = true
    }
  })
  onDestroy(() => {
    abort?.abort()
    if (url) URL.revokeObjectURL(url)
  })

  function clearResult(): void {
    if (url) URL.revokeObjectURL(url)
    url = ''
    result = null
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
        format,
        maxHeight: Number(height),
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
        }}
      />
      <div class="field">
        <span class="label">Format</span>
        <ToggleGroup.Root
          type="single"
          value={format}
          disabled={running}
          onValueChange={(v) => {
            if (v) {
              format = v as ExportFormat
              clearResult()
            }
          }}
          class="formats"
          aria-label="Format"
        >
          <ToggleGroup.Item value="mp4" class="fmt">MP4</ToggleGroup.Item>
          <ToggleGroup.Item value="webm" class="fmt">WebM</ToggleGroup.Item>
        </ToggleGroup.Root>
      </div>
      <SelectField
        label="Maximum resolution"
        value={height}
        options={heights}
        disabled={running}
        onchange={(v) => {
          height = v
          clearResult()
        }}
      />
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
        {#if format === 'mp4' && result.videoCodec !== 'avc'}
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
  :global(.formats) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
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
