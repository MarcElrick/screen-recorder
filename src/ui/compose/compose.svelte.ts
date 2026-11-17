import {
  MIN_RANGE_MS,
  cutOutput,
  defaultEditList,
  editedToOutput,
  isUntouched,
  keepOutput,
  outputDuration,
  outputToEditedSnap,
  removedRanges,
  type EditList,
  type Range,
  DecodedVideo,
  RemoteRenderer,
  fixInfiniteDuration,
  History,
  SessionLoadError,
  SessionPlayer,
  decodePeaks,
  listSessions,
  loadSession,
  nearestCorner,
  pauseMarkers,
  placementForCorner,
  readCachedJson,
  readCompose,
  resizeFromCorner,
  saveManifest,
  trackExtent,
  withCompose,
  withShape,
  withWidth,
  writeCachedJson,
  editedDuration,
  type BubbleShape,
  type Corner,
  type LoadedSession,
  type SessionSummary,
  type Placement,
  type ComposeState,
  readTranscript,
  resolveEdit,
  withTranscript,
  type Envelope,
  type TranscriptState,
  type CaptionStyle,
  type CaptionLayout,
  type Cue,
  type Word,
  captionStarts,
  centerView,
  clampView,
  fullView,
  panView,
  revealView,
  zoomLevel,
  zoomView,
  type View,
  detectFillers,
  joinCaptionWithPrevious,
  longSilences,
  materializeLayout,
  setCaptionText,
  splitCaptionAt,
} from '../../engine'

const SAVE_DELAY_MS = 400

export interface TrackRow {
  id: 'take' | 'audio'
  label: string
  start: number
  end: number
  /** Camera ended early, etc. */
  note?: string
}

interface Snapshot {
  bubble: ComposeState['bubble']
  edit: EditList
  deleted: string[]
  silences: Range[]
  text: Record<string, string>
  layout: CaptionLayout | undefined
}

export class ComposeStore {
  sessions = $state<SessionSummary[]>([])
  sessionId = $state('')
  loading = $state(true)
  error = $state('')
  saved = $state(true)

  session = $state.raw<LoadedSession | null>(null)
  compose = $state<ComposeState | null>(null)
  screenUrl = $state('')
  cameraUrl = $state('')
  hasCameraVideo = $state(true)
  peaks = $state.raw<number[] | null>(null)
  transcript = $state<TranscriptState | null>(null)
  /** Manual cuts plus deleted words: what actually plays and exports. */
  effective = $state.raw<EditList>({ version: 1, ranges: [] })
  cues = $state.raw<Cue[]>([])
  private envelope: Envelope | null = null

  duration = $state(0)
  playhead = $state(0)
  /** The part of the take the timeline shows (output ms). */
  view = $state<View>({ start: 0, span: 1 })
  playing = $state(false)
  aspect = $state(16 / 9)
  /** Where preview frames come from: the video elements or WebCodecs. */
  framesMode = $state<'element' | 'webcodecs' | 'worker'>('element')
  canUndo = $state(false)
  canRedo = $state(false)

  private player: SessionPlayer | null = null
  private unsub: (() => void) | null = null
  private history: History<Snapshot> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  async init(preferred?: string): Promise<void> {
    this.loading = true
    this.error = ''
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
      this.loading = false
      return
    }
    await this.open(id)
  }

  async open(id: string): Promise<void> {
    await this.flush()
    this.release()
    this.loading = true
    this.error = ''
    this.sessionId = id
    try {
      const s = await loadSession(id)
      const compose = readCompose(s.manifest)
      this.session = s
      this.compose = compose
      this.transcript = readTranscript(s.manifest)
      this.envelope = await readCachedJson<Envelope>(id, 'envelope.json')
      this.effective = compose.edit
      this.history = new History<Snapshot>(this.snapshotNow(compose))
      this.selection = null
      this.syncHistoryFlags()
      this.recompute(false)
      this.view = fullView(this.outputTotal)
      this.screenUrl = URL.createObjectURL(s.screen!)
      this.cameraUrl = s.camera ? URL.createObjectURL(s.camera) : ''
      this.playhead = 0
      this.playing = false
      void this.loadPeaks(s)
    } catch (e) {
      this.session = null
      this.compose = null
      this.error =
        e instanceof SessionLoadError
          ? e.message
          : 'Something went wrong opening this take.'
    } finally {
      this.loading = false
    }
  }

  private release(): void {
    if (this.screenUrl) URL.revokeObjectURL(this.screenUrl)
    if (this.cameraUrl) URL.revokeObjectURL(this.cameraUrl)
    this.screenUrl = ''
    this.cameraUrl = ''
    this.peaks = null
  }

  private async loadPeaks(s: LoadedSession): Promise<void> {
    const cam = s.manifest.tracks.find((t) => t.kind === 'camera')
    if (!s.camera || !cam?.hasAudio) return
    const id = s.manifest.id
    const cached = await readCachedJson<number[]>(id, 'waveform.json')
    if (cached) {
      this.peaks = cached
      return
    }
    const peaks = await decodePeaks(s.camera)
    if (peaks && this.sessionId === id) {
      this.peaks = peaks
      void writeCachedJson(id, 'waveform.json', peaks).catch(() => {})
    }
  }

  /**
   * One timeline row for the whole take. The screen and camera are never
   * moved against each other, so only the audio waveform (when there is
   * audio) is drawn on it.
   */
  get rows(): TrackRow[] {
    const m = this.session?.manifest
    if (!m) return []
    const audio = m.tracks.find((t) => t.kind === 'camera' && t.hasAudio)
    if (audio)
      return [{ id: 'audio', label: 'Audio', ...trackExtent(m.pauses, audio) }]
    return [{ id: 'take', label: 'Recording', start: 0, end: this.outputTotal }]
  }

  get markers(): number[] {
    return this.session ? pauseMarkers(this.session.manifest.pauses) : []
  }

  // ---- player wiring -------------------------------------------------

  attach(
    screen: HTMLVideoElement,
    camera: HTMLVideoElement | null,
    canvas: HTMLCanvasElement,
  ): void {
    if (!this.session || !this.compose) return
    this.detach()
    this.framesMode = 'element'
    const p = new SessionPlayer(
      this.session.manifest,
      this.effective,
      screen,
      camera,
      canvas,
      this.compose.bubble,
    )
    this.player = p
    p.captions = this.captionsFor()
    this.unsub = p.subscribe(() => {
      this.playhead = p.playhead
      this.playing = p.playing
    })
    fixInfiniteDuration(screen)
    if (camera) fixInfiniteDuration(camera)
    screen.addEventListener('loadedmetadata', () => {
      if (screen.videoHeight)
        this.aspect = screen.videoWidth / screen.videoHeight
    })
    camera?.addEventListener('loadedmetadata', () => {
      this.hasCameraVideo = camera.videoWidth > 0
    })
    void this.chooseRenderer(p, canvas)
  }

  /**
   * Best renderer first: a worker with its own decoders and canvas, then
   * WebCodecs frames drawn on the main thread, then the video elements.
   */
  private async chooseRenderer(
    p: SessionPlayer,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    const s = this.session
    if (s?.screen && RemoteRenderer.supported(canvas)) {
      const remote = await RemoteRenderer.create(s.screen, s.camera)
      if (this.player !== p) {
        remote?.dispose()
        return
      }
      if (remote) {
        remote.attachCanvas(canvas)
        this.aspect = remote.width / remote.height
        p.setRemote(remote)
        this.framesMode = 'worker'
        p.start()
        return
      }
    }
    p.start()
    await this.useDecodedFrames(p)
  }

  /** Swap in WebCodecs frames when the browser can decode these files. */
  private async useDecodedFrames(p: SessionPlayer): Promise<void> {
    const s = this.session
    if (!s) return
    const [screen, camera] = await Promise.all([
      s.screen ? DecodedVideo.open(s.screen) : null,
      s.camera ? DecodedVideo.open(s.camera) : null,
    ])
    if (this.player !== p || !screen) {
      screen?.dispose()
      camera?.dispose()
      return
    }
    this.aspect = screen.width / screen.height
    p.setFrameSources(screen, camera)
    this.framesMode = 'webcodecs'
  }

  private captionsFor(): { cues: Cue[]; style: CaptionStyle } | null {
    return this.transcript
      ? { cues: this.cues, style: this.transcript.captions }
      : null
  }

  detach(): void {
    this.unsub?.()
    this.unsub = null
    this.player?.dispose()
    this.player = null
  }

  destroy(): void {
    this.detach()
    void this.flush()
    this.release()
  }

  // ---- transport -----------------------------------------------------

  toggle(): void {
    this.player?.toggle()
  }
  seek(ms: number): void {
    this.player?.seek(ms)
  }
  step(ms: number): void {
    this.seek(this.playhead + ms)
  }

  // ---- bubble --------------------------------------------------------

  get placement(): Placement | null {
    return this.compose?.bubble.placement ?? null
  }
  get shape(): BubbleShape {
    return this.compose?.bubble.shape ?? 'circle'
  }
  set shape(s: BubbleShape) {
    if (!this.compose || s === this.shape) return
    this.setBubble(
      {
        shape: s,
        placement: withShape(this.compose.bubble.placement, s, this.aspect),
      },
      true,
    )
  }
  get corner(): Corner {
    return this.placement ? nearestCorner(this.placement) : 'bottom-right'
  }
  set corner(c: Corner) {
    if (!this.compose) return
    this.setBubble(
      {
        shape: this.shape,
        placement: placementForCorner(
          this.compose.bubble.placement,
          c,
          this.aspect,
        ),
      },
      true,
    )
  }
  get width(): number {
    return this.placement?.width ?? 0.2
  }
  set width(w: number) {
    if (!this.compose) return
    this.setBubble(
      {
        shape: this.shape,
        placement: withWidth(this.compose.bubble.placement, w, this.aspect),
      },
      false,
    )
  }

  /** Called while dragging (commit=false) and on release (commit=true). */
  setPlacement(p: Placement, commit: boolean): void {
    this.setBubble({ shape: this.shape, placement: p }, commit)
  }

  resizeFromHandle(
    base: Placement,
    handle: Corner,
    pointer: { x: number; y: number },
  ): Placement {
    return resizeFromCorner(base, handle, pointer, this.aspect)
  }

  commitBubble(): void {
    if (this.compose) this.record()
  }

  resetBubble(): void {
    const m = this.session?.manifest
    if (!m || !this.compose) return
    const fresh = readCompose({ ...m, compose: undefined })
    this.setBubble(fresh.bubble, true)
  }

  private setBubble(b: ComposeState['bubble'], commit: boolean): void {
    if (!this.compose) return
    this.compose.bubble = b
    if (this.player) {
      this.player.layout = b
      this.player.draw()
    }
    this.markDirty()
    if (commit) this.record()
    this.scheduleSave()
  }

  private record(): void {
    if (!this.compose) return
    this.history?.push(this.snapshotNow(this.compose))
    this.syncHistoryFlags()
  }

  private snapshotNow(c: ComposeState): Snapshot {
    return {
      bubble: $state.snapshot(c.bubble) as ComposeState['bubble'],
      edit: $state.snapshot(c.edit) as EditList,
      deleted: [...(this.transcript?.deletedWordIds ?? [])],
      silences: structuredClone(
        $state.snapshot(this.transcript?.silenceCuts ?? []) as Range[],
      ),
      text: { ...(this.transcript?.text ?? {}) },
      layout: this.transcript?.captionLayout
        ? structuredClone(
            $state.snapshot(this.transcript.captionLayout) as CaptionLayout,
          )
        : undefined,
    }
  }

  /**
   * Re-derive the effective edit (manual cuts + deleted words) and push it to
   * the player, the duration and the captions.
   */
  private recompute(emit = true): void {
    if (!this.compose || !this.session) return
    const r = resolveEdit(
      this.session.manifest,
      this.envelope,
      $state.snapshot(this.compose) as ComposeState,
      this.transcript
        ? ($state.snapshot(this.transcript) as TranscriptState)
        : null,
    )
    this.effective = r.effective
    this.cues = r.cues
    this.duration = editedDuration(r.effective)
    if (this.player) {
      this.player.captions = r.captions
      if (emit) this.player.setEdit(r.effective)
    }
    if (emit) this.playhead = this.player?.playhead ?? 0
  }

  get captionStyle(): CaptionStyle | null {
    return this.transcript?.captions ?? null
  }
  setCaptionStyle(patch: Partial<CaptionStyle>): void {
    if (!this.transcript) return
    this.transcript.captions = { ...this.transcript.captions, ...patch }
    this.recompute()
    this.player?.draw()
    this.markDirty()
    this.scheduleSave()
  }

  undo(): void {
    this.applyHistory(this.history?.undo())
  }
  redo(): void {
    this.applyHistory(this.history?.redo())
  }
  private applyHistory(snap: Snapshot | undefined): void {
    if (!snap || !this.compose) return
    this.syncHistoryFlags()
    if (this.transcript) {
      this.transcript.deletedWordIds = [...snap.deleted]
      this.transcript.silenceCuts = structuredClone(snap.silences)
      this.transcript.text = { ...snap.text }
      this.transcript.captionLayout = snap.layout
        ? structuredClone(snap.layout)
        : undefined
    }
    this.setEdit(structuredClone(snap.edit), false)
    this.setBubble(structuredClone(snap.bubble), false)
  }
  private syncHistoryFlags(): void {
    this.canUndo = this.history?.canUndo ?? false
    this.canRedo = this.history?.canRedo ?? false
  }

  // ---- trim and cut --------------------------------------------------

  /** Selection on the source timeline (output ms), set with Mark in/out. */
  selection = $state<{ start: number; end: number } | null>(null)
  private markStart: number | null = null

  get edit(): EditList | null {
    return this.compose?.edit ?? null
  }
  /** Length of the whole take on the source timeline (cuts included). */
  get outputTotal(): number {
    return this.session ? outputDuration(this.session.manifest) : 0
  }
  get removed(): Range[] {
    return this.compose ? removedRanges(this.effective, this.outputTotal) : []
  }
  get edited(): boolean {
    return !!this.compose && !isUntouched(this.effective, this.outputTotal)
  }
  /** The playhead on the source timeline. */
  get playheadOutput(): number {
    return this.compose ? editedToOutput(this.effective, this.playhead) : 0
  }

  /** Seek to a point on the source timeline; cut points snap forward. */
  seekOutput(ms: number): void {
    if (!this.compose) return
    this.seek(outputToEditedSnap(this.effective, ms))
  }

  markIn(): void {
    this.markStart = this.playheadOutput
    const end = this.selection?.end ?? this.outputTotal
    this.selection = {
      start: Math.min(this.markStart, end),
      end: Math.max(this.markStart, end),
    }
    if (this.selection.end - this.selection.start < MIN_RANGE_MS)
      this.selection = { start: this.markStart, end: this.outputTotal }
  }
  markOut(): void {
    const at = this.playheadOutput
    const start = this.markStart ?? this.selection?.start ?? 0
    this.selection = { start: Math.min(start, at), end: Math.max(start, at) }
  }
  /** Select the range between two points (dragging on the timeline). */
  selectRange(a: number, b: number): void {
    const start = Math.max(0, Math.min(a, b))
    const end = Math.min(this.outputTotal, Math.max(a, b))
    this.markStart = start
    this.selection = { start, end }
  }
  clearSelection(): void {
    this.selection = null
    this.markStart = null
  }

  cutSelection(): void {
    const sel = this.selection
    if (sel) this.applyEdit((e) => cutOutput(e, sel.start, sel.end))
    this.clearSelection()
  }
  keepSelection(): void {
    const sel = this.selection
    if (sel) this.applyEdit((e) => keepOutput(e, sel.start, sel.end))
    this.clearSelection()
  }
  trimStart(): void {
    const at = this.playheadOutput
    this.applyEdit((e) => cutOutput(e, 0, at))
  }
  trimEnd(): void {
    const at = this.playheadOutput
    this.applyEdit((e) => cutOutput(e, at, this.outputTotal))
  }
  restoreAll(): void {
    if (this.transcript) {
      this.transcript.deletedWordIds = []
      this.transcript.silenceCuts = []
    }
    this.applyEdit(() => defaultEditList(this.outputTotal))
    // The manual edit may already be untouched; still record the restore.
    this.recompute()
    this.record()
    this.markDirty()
    this.scheduleSave()
    this.clearSelection()
  }

  private applyEdit(fn: (e: EditList) => EditList): void {
    if (!this.compose) return
    const next = fn($state.snapshot(this.compose.edit) as EditList)
    if (JSON.stringify(next) === JSON.stringify(this.compose.edit)) return
    this.setEdit(next, true)
  }

  private setEdit(edit: EditList, commit: boolean): void {
    if (!this.compose) return
    this.compose.edit = edit
    this.recompute()
    this.markDirty()
    if (commit) this.record()
    this.scheduleSave()
  }

  // ---- timeline zoom -------------------------------------------------

  get zoom(): number {
    return zoomLevel(this.view, this.outputTotal)
  }
  setView(v: View): void {
    this.view = clampView(v, this.outputTotal)
  }
  /** Zoom in (factor > 1) or out, keeping `anchorMs` (default: the playhead) in place. */
  zoomBy(factor: number, anchorMs = this.playheadOutput): void {
    this.view = zoomView(this.view, this.outputTotal, factor, anchorMs)
  }
  zoomFit(): void {
    this.view = fullView(this.outputTotal)
  }
  panBy(deltaMs: number): void {
    this.view = panView(this.view, this.outputTotal, deltaMs)
  }
  centerOn(ms: number): void {
    this.view = centerView(this.view, this.outputTotal, ms)
  }
  /** Scroll the view so `ms` is visible (used while playing). */
  reveal(ms: number): void {
    const next = revealView(this.view, this.outputTotal, ms)
    if (next !== this.view) this.view = next
  }

  // ---- transcript editing (one flow with the timeline) ---------------

  get words(): Word[] {
    return this.transcript?.words ?? []
  }
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- derived value, never mutated
  deleted = $derived(new Set(this.transcript?.deletedWordIds ?? []))
  /** Ids of the words that start a caption. */
  starts = $derived(captionStarts(this.cues))

  wordText(w: Word): string {
    return (this.transcript?.text[w.id] ?? w.text).trim()
  }
  /** kept, deleted by a word edit, or already cut by a timeline cut. */
  statusOf(w: Word): 'kept' | 'deleted' | 'cut' {
    if (this.deleted.has(w.id)) return 'deleted'
    const mid = (w.startMs + w.endMs) / 2
    const manual = this.compose?.edit
    if (
      manual &&
      !manual.ranges.some((r) => mid >= r.startMs && mid <= r.endMs)
    )
      return 'cut'
    return 'kept'
  }

  /**
   * The words covered by the timeline selection (centre inside it), as an
   * index range. The selection is the one shared notion of "what is picked",
   * whether it was dragged on the timeline or made from words.
   */
  selectedWords = $derived.by((): { from: number; to: number } | null => {
    const sel = this.selection
    const ws = this.transcript?.words
    if (!sel || !ws) return null
    let from = -1
    let to = -1
    ws.forEach((w, i) => {
      const mid = (w.startMs + w.endMs) / 2
      if (mid >= sel.start && mid <= sel.end) {
        if (from < 0) from = i
        to = i
      }
    })
    return from < 0 ? null : { from, to }
  })
  get selectedIds(): string[] {
    const r = this.selectedWords
    return r ? this.words.slice(r.from, r.to + 1).map((w) => w.id) : []
  }
  /** The word under the playhead, or -1. */
  activeWord = $derived.by((): number => {
    const ws = this.transcript?.words
    if (!ws) return -1
    const ms = this.playheadOutput
    let lo = 0
    let hi = ws.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (ws[mid].startMs <= ms) {
        found = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return found >= 0 && ms <= ws[found].endMs + 250 ? found : -1
  })

  /** Click a word: select it (Shift extends) and jump there. */
  clickWord(i: number, extend: boolean): void {
    const ws = this.words
    const w = ws[i]
    if (!w) return
    const cur = this.selectedWords
    const from = extend && cur ? Math.min(cur.from, i) : i
    const to = extend && cur ? Math.max(cur.to, i) : i
    this.selectRange(ws[from].startMs, ws[to].endMs)
    this.seekOutput(w.startMs)
  }

  /** Delete the selected words, or restore them when all are already deleted. */
  toggleSelectedWords(): void {
    const ids = this.selectedIds
    if (!ids.length || !this.transcript) return
    this.setDeleted(ids, !ids.every((id) => this.deleted.has(id)))
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
    this.commitTranscript()
  }
  /** Save a transcript change: re-derive the edit, record undo, persist. */
  private commitTranscript(): void {
    this.recompute()
    this.markDirty()
    this.record()
    // Word and caption edits are saved straight away, not after a pause.
    void this.flush()
  }

  setWordText(id: string, text: string): void {
    const t = this.transcript
    const w = t?.words.find((x) => x.id === id)
    if (!t || !w) return
    const clean = text.trim()
    if (!clean || clean === w.text) delete t.text[id]
    else t.text[id] = clean
    this.commitTranscript()
  }

  /** Move every word earlier (negative) or later: a manual timing fix. */
  shiftWords(deltaMs: number): void {
    const t = this.transcript
    if (!t) return
    const total = this.outputTotal
    t.words = (t.words as Word[]).map((w) => {
      const startMs = Math.min(Math.max(0, w.startMs + deltaMs), total - 1)
      return {
        ...w,
        startMs,
        endMs: Math.min(Math.max(startMs + 1, w.endMs + deltaMs), total),
      }
    })
    t.shiftMs = (t.shiftMs ?? 0) + deltaMs
    this.recompute()
    this.markDirty()
    this.scheduleSave()
  }

  get fillers() {
    return this.transcript
      ? detectFillers(this.words, this.transcript.text)
      : []
  }
  removeFillers(ids: string[]): void {
    this.setDeleted(ids, true)
  }
  get silenceGaps() {
    const t = this.transcript
    if (!t) return []
    return longSilences(this.words, this.deleted).filter(
      (g) =>
        !t.silenceCuts.some(
          (c) => c.startMs <= g.startMs && c.endMs >= g.endMs,
        ),
    )
  }
  tightenSilences(): void {
    const t = this.transcript
    const gaps = this.silenceGaps
    if (!t || !gaps.length) return
    t.silenceCuts = [...t.silenceCuts, ...gaps]
    this.commitTranscript()
  }

  // Captions: wording, splitting and joining, kept apart from the words.

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
    this.commitTranscript()
  }
  resetCueText(key: string): void {
    const cue = this.cues.find((c) => c.key === key)
    if (cue) this.setCueText(key, cue.autoText ?? '')
  }
  get canStartCaption(): boolean {
    const i = this.selectedWords?.from ?? -1
    return i > 0 && !this.starts.has(this.words[i].id)
  }
  get canJoinCaption(): boolean {
    const i = this.selectedWords?.from ?? -1
    return i > 0 && this.starts.has(this.words[i].id)
  }
  startCaptionAtSelection(): void {
    const t = this.transcript
    const i = this.selectedWords?.from ?? -1
    if (!t || i <= 0) return
    t.captionLayout = splitCaptionAt(this.layout(), t.words, i)
    this.commitTranscript()
  }
  joinCue(key: string): void {
    const t = this.transcript
    if (!t) return
    const next = joinCaptionWithPrevious(this.layout(), t.words, key, (k) =>
      this.shown(k),
    )
    if (JSON.stringify(next) === JSON.stringify(t.captionLayout)) return
    t.captionLayout = next
    this.commitTranscript()
  }
  joinSelectedCaption(): void {
    const w = this.words[this.selectedWords?.from ?? -1]
    if (w) this.joinCue(w.id)
  }
  resetCaptionEdits(): void {
    const t = this.transcript
    if (!t?.captionLayout) return
    t.captionLayout = undefined
    this.commitTranscript()
  }
  /** Jump to the start of a caption (edited time). */
  seekCue(startEdited: number): void {
    this.seek(startEdited)
  }

  // ---- persistence ---------------------------------------------------

  private scheduleSave(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }

  private rev = 0
  private writing: Promise<void> = Promise.resolve()
  private markDirty(): void {
    this.saved = false
    this.rev++
  }

  /** Save now. Writes are queued, and a change made mid-write is saved after it. */
  flush(): Promise<void> {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    this.writing = this.writing.then(() => this.write())
    return this.writing
  }

  private async write(): Promise<void> {
    if (this.saved || !this.session || !this.compose) return
    const rev = this.rev
    const id = this.session.manifest.id
    try {
      const withC = withCompose(
        this.session.manifest,
        $state.snapshot(this.compose) as ComposeState,
      )
      await saveManifest(
        id,
        this.transcript
          ? withTranscript(
              withC,
              $state.snapshot(this.transcript) as TranscriptState,
            )
          : withC,
      )
      // Only clean if nothing changed while the write was running.
      if (this.rev === rev) this.saved = true
    } catch {
      this.error = 'Could not save your changes.'
    }
  }
}
