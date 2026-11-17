import {
  DecodedVideo,
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
  type Placement,
  type ComposeState,
} from '../../engine'

const SAVE_DELAY_MS = 400

export interface TrackRow {
  id: 'screen' | 'camera' | 'audio'
  label: string
  start: number
  end: number
  /** Camera ended early, etc. */
  note?: string
}

export class ComposeStore {
  sessions = $state<{ id: string; createdAt: string; durationMs: number }[]>([])
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

  duration = $state(0)
  playhead = $state(0)
  playing = $state(false)
  aspect = $state(16 / 9)
  /** Where preview frames come from: the video elements or WebCodecs. */
  framesMode = $state<'element' | 'webcodecs'>('element')
  canUndo = $state(false)
  canRedo = $state(false)

  private player: SessionPlayer | null = null
  private unsub: (() => void) | null = null
  private history: History<ComposeState['bubble']> | null = null
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
      this.history = new History(compose.bubble)
      this.syncHistoryFlags()
      this.duration = editedDuration(compose.edit)
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

  get rows(): TrackRow[] {
    const m = this.session?.manifest
    if (!m) return []
    const rows: TrackRow[] = []
    for (const t of m.tracks) {
      const e = trackExtent(m.pauses, t)
      if (t.kind === 'screen') {
        rows.push({ id: 'screen', label: 'Screen', ...e })
      } else {
        if (this.hasCameraVideo)
          rows.push({
            id: 'camera',
            label: 'Camera',
            ...e,
            note: t.endedEarly ? 'Ended early' : undefined,
          })
        if (t.hasAudio) rows.push({ id: 'audio', label: 'Audio', ...e })
      }
    }
    return rows
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
      this.compose.edit,
      screen,
      camera,
      canvas,
      this.compose.bubble,
    )
    this.player = p
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
    p.start()
    void this.useDecodedFrames(p)
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
    if (this.compose) this.record(this.compose.bubble)
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
    if (commit) this.record(b)
    this.scheduleSave()
  }

  private record(b: ComposeState['bubble']): void {
    this.history?.push($state.snapshot(b) as ComposeState['bubble'])
    this.syncHistoryFlags()
  }

  undo(): void {
    this.applyHistory(this.history?.undo())
  }
  redo(): void {
    this.applyHistory(this.history?.redo())
  }
  private applyHistory(b: ComposeState['bubble'] | undefined): void {
    if (!b) return
    this.syncHistoryFlags()
    this.setBubble(structuredClone(b), false)
  }
  private syncHistoryFlags(): void {
    this.canUndo = this.history?.canUndo ?? false
    this.canRedo = this.history?.canRedo ?? false
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
      await saveManifest(
        id,
        withCompose(
          this.session.manifest,
          $state.snapshot(this.compose) as ComposeState,
        ),
      )
      this.saved = true
    } catch {
      this.error = 'Could not save your changes.'
    }
  }
}
