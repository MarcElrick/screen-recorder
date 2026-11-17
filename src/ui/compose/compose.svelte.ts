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
  type Cue,
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
    this.saved = false
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
    this.saved = false
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
    this.saved = false
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
    this.saved = false
    if (commit) this.record()
    this.scheduleSave()
  }

  // ---- persistence ---------------------------------------------------

  private scheduleSave(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }

  async flush(): Promise<void> {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    if (this.saved || !this.session || !this.compose) return
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
      this.saved = true
    } catch {
      this.error = 'Could not save your changes.'
    }
  }
}
