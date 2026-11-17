import {
  DEFAULT_CAPTION_STYLE,
  DEFAULT_MODEL,
  History,
  SessionLoadError,
  SpeechModel,
  ALIGN_VERSION,
  alignWords,
  captionStarts,
  joinCaptionWithPrevious,
  materializeLayout,
  setCaptionText,
  splitCaptionAt,
  detectFillers,
  listSessions,
  loadSession,
  longSilences,
  outputDuration,
  prepareAudio,
  readCachedJson,
  readCompose,
  readTranscript,
  removedRanges,
  resolveEdit,
  saveManifest,
  speech,
  trackExtent,
  withTranscript,
  writeCachedJson,
  type CaptionLayout,
  type Cue,
  type Envelope,
  type LoadedSession,
  type ModelId,
  type ModelState,
  type Range,
  type SessionSummary,
  type TranscriptState,
  type Word,
} from '../../engine'

export type Phase =
  | 'loading'
  | 'empty'
  | 'no-audio'
  | 'unsupported'
  | 'ready'
  | 'working'
  | 'editing'

interface Snapshot {
  deleted: string[]
  silences: Range[]
  text: Record<string, string>
  layout: CaptionLayout | undefined
}

export type WordStatus = 'kept' | 'deleted' | 'cut'

export class AnnotateStore {
  sessions = $state<SessionSummary[]>([])
  sessionId = $state('')
  phase = $state<Phase>('loading')
  error = $state('')
  /** What the generate step is doing right now. */
  step = $state('')
  model = $state<ModelId>(DEFAULT_MODEL)
  language = $state('auto')
  modelState = $state<ModelState>(speech.state)
  modelCached = $state(false)

  session = $state.raw<LoadedSession | null>(null)
  transcript = $state<TranscriptState | null>(null)
  envelope = $state.raw<Envelope | null>(null)
  cameraUrl = $state('')
  screenUrl = $state('')
  canUndo = $state(false)
  canRedo = $state(false)
  /** Selected word range (indices), inclusive. */
  selection = $state<{ from: number; to: number } | null>(null)

  private history: History<Snapshot> | null = null
  private unsub: (() => void) | null = null
  private saveChain: Promise<void> = Promise.resolve()
  private abort = false

  constructor() {
    this.unsub = speech.subscribe((s) => (this.modelState = s))
  }

  destroy(): void {
    this.unsub?.()
    this.release()
  }

  private release(): void {
    if (this.cameraUrl) URL.revokeObjectURL(this.cameraUrl)
    if (this.screenUrl) URL.revokeObjectURL(this.screenUrl)
    this.cameraUrl = ''
    this.screenUrl = ''
  }

  async init(preferred?: string): Promise<void> {
    this.phase = 'loading'
    if (!SpeechModel.supported()) {
      this.phase = 'unsupported'
      return
    }
    try {
      this.sessions = await listSessions()
    } catch {
      this.sessions = []
    }
    const id =
      preferred && this.sessions.some((s) => s.id === preferred)
        ? preferred
        : this.sessions[0]?.id
    if (!id) {
      this.phase = 'empty'
      return
    }
    await this.open(id)
  }

  async open(id: string): Promise<void> {
    await this.flush()
    this.release()
    this.sessionId = id
    this.error = ''
    this.selection = null
    this.phase = 'loading'
    this.modelCached = await SpeechModel.isCached(this.model)
    try {
      const s = await loadSession(id)
      this.session = s
      const cam = s.manifest.tracks.find((t) => t.kind === 'camera')
      if (!s.camera || !cam?.hasAudio) {
        this.transcript = null
        this.phase = 'no-audio'
        return
      }
      this.cameraUrl = URL.createObjectURL(s.camera)
      if (s.screen) this.screenUrl = URL.createObjectURL(s.screen)
      this.transcript = readTranscript(s.manifest)
      this.envelope = await readCachedJson<Envelope>(id, 'envelope.json')
      // Transcripts made before timing alignment get it once, from the cached envelope.
      if (
        this.transcript &&
        (this.transcript.alignVersion ?? 0) < ALIGN_VERSION &&
        this.envelope
      ) {
        this.realign()
        void this.persist()
      }
      this.history = this.transcript
        ? new History<Snapshot>(this.snap(this.transcript))
        : null
      this.sync()
      this.phase = this.transcript ? 'editing' : 'ready'
    } catch (e) {
      this.session = null
      this.error =
        e instanceof SessionLoadError
          ? e.message
          : 'Something went wrong opening this take.'
      this.phase = 'ready'
    }
  }

  // ---- derived timeline -----------------------------------------------

  get total(): number {
    return this.session ? outputDuration(this.session.manifest) : 0
  }
  /** Where the camera/mic file starts on the output timeline. */
  get audioStart(): number {
    const m = this.session?.manifest
    const cam = m?.tracks.find((t) => t.kind === 'camera')
    return m && cam ? trackExtent(m.pauses, cam).start : 0
  }
  get screenStart(): number {
    const m = this.session?.manifest
    const st = m?.tracks.find((t) => t.kind === 'screen')
    return m && st ? trackExtent(m.pauses, st).start : 0
  }
  resolved = $derived.by(() => {
    const s = this.session
    if (!s) return null
    return resolveEdit(
      s.manifest,
      this.envelope,
      readCompose(s.manifest),
      this.transcript
        ? ($state.snapshot(this.transcript) as TranscriptState)
        : null,
    )
  })
  /** Ranges that will not play (word deletes and Compose cuts), output ms. */
  removed = $derived.by((): Range[] => {
    const r = this.resolved
    return r ? removedRanges(r.effective, this.total) : []
  })
  get keptMs(): number {
    return (
      this.total - this.removed.reduce((n, r) => n + r.endMs - r.startMs, 0)
    )
  }
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived value, never mutated
  deleted = $derived(new Set(this.transcript?.deletedWordIds ?? []))
  get words(): Word[] {
    return this.transcript?.words ?? []
  }
  wordText(w: Word): string {
    return (this.transcript?.text[w.id] ?? w.text).trim()
  }
  /** Words already cut by Compose's manual cuts (read-only here). */
  statusOf(w: Word, manual = this.resolved?.compose.edit): WordStatus {
    if (this.deleted.has(w.id)) return 'deleted'
    const mid = (w.startMs + w.endMs) / 2
    if (
      manual &&
      !manual.ranges.some((r) => mid >= r.startMs && mid <= r.endMs)
    )
      return 'cut'
    return 'kept'
  }

  // ---- model ----------------------------------------------------------

  setModel(m: ModelId): void {
    this.model = m
    void SpeechModel.isCached(m).then((c) => (this.modelCached = c))
  }

  /** Transcribe the mic track. Replaces any existing transcript. */
  async generate(): Promise<void> {
    const s = this.session
    if (!s?.camera) return
    this.error = ''
    this.abort = false
    this.phase = 'working'
    try {
      this.step = 'Loading the speech model'
      await speech.load(this.model)
      if (this.abort) return
      this.step = 'Preparing the audio'
      const audio = await prepareAudio(s.camera, this.audioStart)
      if (!audio) throw new Error("This browser couldn't decode the audio.")
      if (this.abort) return
      this.step = 'Transcribing'
      const out = await speech.transcribe(audio.samples, {
        offsetMs: this.audioStart,
        totalMs: this.total,
        language: this.language === 'auto' ? undefined : this.language,
      })
      if (this.abort) return
      if (out.words.length === 0)
        throw new Error('No speech was found in this take.')
      this.envelope = audio.envelope
      void writeCachedJson(
        this.sessionId,
        'envelope.json',
        audio.envelope,
      ).catch(() => {})
      this.transcript = {
        version: 1,
        model: this.model,
        language: out.language,
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a timestamp
        createdAt: new Date().toISOString(),
        words: alignWords(out.words, audio.envelope),
        aligned: true,
        alignVersion: ALIGN_VERSION,
        shiftMs: 0,
        text: {},
        deletedWordIds: [],
        silenceCuts: [],
        captions: { ...DEFAULT_CAPTION_STYLE },
      }
      this.history = new History<Snapshot>(this.snap(this.transcript))
      this.sync()
      await this.persist()
      this.phase = 'editing'
    } catch (e) {
      if (this.abort) return
      this.error = e instanceof Error ? e.message : String(e)
      this.phase = 'ready'
    } finally {
      this.step = ''
    }
  }

  cancel(): void {
    this.abort = true
    speech.cancel()
    this.phase = this.transcript ? 'editing' : 'ready'
    this.step = ''
  }

  /** Throw the transcript away (the original recording is untouched). */
  async discard(): Promise<void> {
    this.transcript = null
    this.history = null
    this.selection = null
    this.sync()
    await this.persist()
    this.phase = 'ready'
  }

  // ---- editing --------------------------------------------------------

  private snap(t: TranscriptState): Snapshot {
    return {
      deleted: [...t.deletedWordIds],
      silences: structuredClone($state.snapshot(t.silenceCuts) as Range[]),
      text: { ...t.text },
      layout: t.captionLayout
        ? structuredClone($state.snapshot(t.captionLayout) as CaptionLayout)
        : undefined,
    }
  }
  private sync(): void {
    this.canUndo = this.history?.canUndo ?? false
    this.canRedo = this.history?.canRedo ?? false
  }
  private commit(): void {
    if (!this.transcript) return
    this.history?.push(this.snap(this.transcript))
    this.sync()
    void this.persist()
  }
  undo(): void {
    this.apply(this.history?.undo())
  }
  redo(): void {
    this.apply(this.history?.redo())
  }
  private apply(s: Snapshot | undefined): void {
    if (!s || !this.transcript) return
    this.transcript.deletedWordIds = [...s.deleted]
    this.transcript.silenceCuts = structuredClone(s.silences)
    this.transcript.text = { ...s.text }
    this.transcript.captionLayout = s.layout
      ? structuredClone(s.layout)
      : undefined
    this.sync()
    void this.persist()
  }

  select(from: number, to = from): void {
    this.selection = { from: Math.min(from, to), to: Math.max(from, to) }
  }
  clearSelection(): void {
    this.selection = null
  }
  get selectedIds(): string[] {
    const sel = this.selection
    if (!sel) return []
    return this.words.slice(sel.from, sel.to + 1).map((w) => w.id)
  }

  /** Delete the selection, or restore it when it's already all deleted. */
  toggleSelection(): void {
    const ids = this.selectedIds
    if (!ids.length || !this.transcript) return
    const del = this.deleted
    const restore = ids.every((id) => del.has(id))
    this.setDeleted(ids, !restore)
  }

  setDeleted(ids: string[], deleted: boolean): void {
    if (!this.transcript) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local copy
    const set = new Set(this.deleted)
    for (const id of ids) {
      if (deleted) set.add(id)
      else set.delete(id)
    }
    this.transcript.deletedWordIds = [...set]
    this.commit()
  }

  restoreAll(): void {
    if (!this.transcript) return
    this.transcript.deletedWordIds = []
    this.transcript.silenceCuts = []
    this.commit()
  }

  setText(id: string, text: string): void {
    if (!this.transcript) return
    const w = this.words.find((x) => x.id === id)
    if (!w) return
    const clean = text.trim()
    if (!clean || clean === w.text) delete this.transcript.text[id]
    else this.transcript.text[id] = clean
    this.commit()
  }

  /** Re-run the audio alignment from Whisper's raw times, then re-apply any manual shift. */
  private realign(): void {
    const t = this.transcript
    if (!t || !this.envelope) return
    const shift = t.shiftMs ?? 0
    const aligned = alignWords(
      $state.snapshot(t.words) as Word[],
      this.envelope,
    )
    t.words = shift ? this.shifted(aligned, shift) : aligned
    t.aligned = true
    t.alignVersion = ALIGN_VERSION
  }

  private shifted(words: Word[], deltaMs: number): Word[] {
    const total = this.total
    return words.map((w) => {
      const startMs = Math.min(Math.max(0, w.startMs + deltaMs), total - 1)
      return {
        ...w,
        startMs,
        endMs: Math.min(Math.max(startMs + 1, w.endMs + deltaMs), total),
      }
    })
  }

  /** Move every word earlier (negative) or later by `deltaMs`: a manual timing fix. */
  shiftWords(deltaMs: number): void {
    const t = this.transcript
    if (!t) return
    t.words = this.shifted($state.snapshot(t.words) as Word[], deltaMs)
    t.shiftMs = (t.shiftMs ?? 0) + deltaMs
    void this.persist()
  }

  setCaptions(patch: Partial<TranscriptState['captions']>): void {
    if (!this.transcript) return
    this.transcript.captions = { ...this.transcript.captions, ...patch }
    void this.persist()
  }

  // ---- caption editing -------------------------------------------------

  cues = $derived<Cue[]>(this.resolved?.cues ?? [])
  /** Ids of the words that start a caption. */
  starts = $derived(captionStarts(this.cues))

  /** The editable layout, created from the automatic grouping on first edit. */
  private layout(): CaptionLayout {
    const t = this.transcript!
    return t.captionLayout
      ? ($state.snapshot(t.captionLayout) as CaptionLayout)
      : materializeLayout(this.cues, t.words)
  }
  private shown(key: string): string {
    return this.cues.find((c) => c.key === key)?.text ?? ''
  }

  setCueText(key: string, text: string): void {
    const t = this.transcript
    const cue = this.cues.find((c) => c.key === key)
    if (!t || !cue) return
    const next = setCaptionText(this.layout(), key, text, cue.autoText ?? '')
    if (JSON.stringify(next) === JSON.stringify(t.captionLayout)) return
    t.captionLayout = next
    this.commit()
  }
  /** Reset one caption's text back to what the words say. */
  resetCueText(key: string): void {
    const cue = this.cues.find((c) => c.key === key)
    if (cue) this.setCueText(key, cue.autoText ?? '')
  }

  get selectedIndex(): number {
    return this.selection ? this.selection.from : -1
  }
  get canStartCaption(): boolean {
    const i = this.selectedIndex
    return i > 0 && !this.starts.has(this.words[i].id)
  }
  get canJoinCaption(): boolean {
    const i = this.selectedIndex
    return i > 0 && this.starts.has(this.words[i].id)
  }
  /** Begin a new caption at the selected word. */
  startCaptionAtSelection(): void {
    const t = this.transcript
    const i = this.selectedIndex
    if (!t || i <= 0) return
    t.captionLayout = splitCaptionAt(this.layout(), t.words, i)
    this.commit()
  }
  joinCue(key: string): void {
    const t = this.transcript
    if (!t) return
    const next = joinCaptionWithPrevious(this.layout(), t.words, key, (k) =>
      this.shown(k),
    )
    if (JSON.stringify(next) === JSON.stringify(t.captionLayout)) return
    t.captionLayout = next
    this.commit()
  }
  joinSelectedCaption(): void {
    const w = this.words[this.selectedIndex]
    if (w) this.joinCue(w.id)
  }
  /** Back to automatic caption grouping, dropping custom text. */
  resetCaptionEdits(): void {
    const t = this.transcript
    if (!t?.captionLayout) return
    t.captionLayout = undefined
    this.commit()
  }

  // ---- extras: fillers and silences ------------------------------------

  get fillers() {
    return this.transcript
      ? detectFillers(this.words, this.transcript.text)
      : []
  }
  removeFillers(ids: string[]): void {
    this.setDeleted(ids, true)
  }
  get silenceGaps() {
    return this.transcript
      ? longSilences(this.words, this.deleted).filter(
          (g) =>
            !this.transcript!.silenceCuts.some(
              (c) => c.startMs <= g.startMs && c.endMs >= g.endMs,
            ),
        )
      : []
  }
  tightenSilences(): void {
    if (!this.transcript) return
    const gaps = this.silenceGaps
    if (!gaps.length) return
    this.transcript.silenceCuts = [...this.transcript.silenceCuts, ...gaps]
    this.commit()
  }

  // ---- persistence ----------------------------------------------------

  private persist(): Promise<void> {
    const s = this.session
    if (!s) return Promise.resolve()
    const t = this.transcript
      ? ($state.snapshot(this.transcript) as TranscriptState)
      : undefined
    this.saveChain = this.saveChain
      .then(() => saveManifest(s.manifest.id, withTranscript(s.manifest, t)))
      .catch(() => {
        this.error = 'Could not save your changes.'
      })
    return this.saveChain
  }

  async flush(): Promise<void> {
    await this.saveChain
  }
}
