import { SessionClock } from '../recording/clock'
import { withTimeout } from '../recording/timeout'
import { JournalWriter, type JournalTrack } from './journal'
import { fixWebm } from '../recording/webm-fix'
import { pickMime } from '../recording/mime'
import {
  TrackRecorder,
  type TrackKind,
  type TrackResult,
} from '../recording/track-recorder'
import {
  defaultSinkFactory,
  canStreamToOpfs,
  persistFile,
  writeJson,
  type SinkFactory,
} from '../storage/sink'
import { rememberSession } from '../storage/session-store'
import { bubblePlacement, type BubbleSettings } from '../compositing/placement'
import { buildManifest, type SessionManifest } from './manifest'
import {
  initialState,
  type Phase,
  reduce,
  type SessionEvent,
  type SessionState,
} from './state'

export interface SessionOutput {
  manifest: SessionManifest
  tracks: TrackResult[]
}

export interface ControllerDeps {
  sinkFactory?: SinkFactory
  clock?: () => SessionClock
  id?: () => string
  /** Test seam: the countdown delay. */
  wait?: (ms: number) => Promise<void>
}

/**
 * Drives the state machine and the per-track recorders. Framework-free: the UI
 * subscribes via `subscribe` and calls the methods below.
 */
export class SessionController {
  state: SessionState = initialState
  private listeners = new Set<(s: SessionState) => void>()
  private screen: MediaStream | null = null
  private camera: MediaStream | null = null
  private recorders: TrackRecorder[] = []
  private clock = new SessionClock()
  private startedAt = new Date()
  private sessionId = ''
  private bubble: BubbleSettings | null = null
  private countdownToken = 0
  output: SessionOutput | null = null

  constructor(private readonly deps: ControllerDeps = {}) {}

  subscribe(fn: (s: SessionState) => void): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private dispatch(e: SessionEvent): void {
    const next = reduce(this.state, e)
    if (next === this.state) return
    this.state = next
    for (const l of this.listeners) l(next)
  }

  elapsedMs(): number {
    return this.clock.elapsed()
  }

  setScreen(stream: MediaStream): void {
    this.screen?.getTracks().forEach((t) => t.stop())
    this.screen = stream
    const track = stream.getVideoTracks()[0]
    track?.addEventListener('ended', () => {
      if (this.screen !== stream) return
      if (this.state.phase === 'recording' || this.state.phase === 'paused') {
        this.dispatch({
          type: 'notice',
          message: 'Screen sharing stopped. Your take was saved.',
        })
        void this.stop()
      } else if (this.state.phase === 'countdown') {
        this.cancelCountdown()
        this.releaseScreen()
      } else {
        this.releaseScreen()
      }
    })
    this.dispatch({ type: 'screenChosen' })
  }

  private releaseScreen(): void {
    this.screen?.getTracks().forEach((t) => t.stop())
    this.screen = null
    this.dispatch({ type: 'screenLost' })
  }

  setCamera(stream: MediaStream | null): void {
    this.camera?.getTracks().forEach((t) => t.stop())
    this.camera = stream
  }

  setBubble(b: BubbleSettings | null): void {
    this.bubble = b
  }

  async start(opts: { countdownSeconds?: number } = {}): Promise<void> {
    if (this.state.phase !== 'ready' || !this.screen) return
    const secs = opts.countdownSeconds ?? 0
    this.dispatch({ type: 'start', countdown: secs > 0 })
    if (secs > 0) {
      const token = ++this.countdownToken
      const wait =
        this.deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
      await wait(secs * 1000)
      if (
        token !== this.countdownToken ||
        (this.state.phase as Phase) !== 'countdown'
      )
        return
      this.dispatch({ type: 'countdownDone' })
    }
    await this.begin()
  }

  cancelCountdown(): void {
    this.countdownToken++
    this.dispatch({ type: 'cancelCountdown' })
  }

  private async begin(): Promise<void> {
    try {
      const sinkFactory = this.deps.sinkFactory ?? defaultSinkFactory
      this.sessionId = this.deps.id?.() ?? `take-${Date.now()}`
      this.startedAt = new Date()
      this.clock = this.deps.clock?.() ?? new SessionClock()
      const mk = async (
        kind: TrackKind,
        file: string,
        stream: MediaStream,
      ): Promise<TrackRecorder> =>
        new TrackRecorder({
          kind,
          file,
          stream,
          mime: pickMime(undefined, {
            video: stream.getVideoTracks().length > 0,
            audio: stream.getAudioTracks().length > 0,
          }),
          sink: await sinkFactory(this.sessionId, file, () =>
            this.dispatch({
              type: 'notice',
              message: `Couldn't write the ${kind} file to browser storage; keeping it in memory instead.`,
            }),
          ),
          clock: this.clock,
          onEnded: (k) => this.onTrackEnded(k),
          onError: (k, err) =>
            this.dispatch({
              type: 'notice',
              message: `Writing the ${k} file failed: ${err instanceof Error ? err.message : err}`,
            }),
        })
      this.recorders = [await mk('screen', 'screen.webm', this.screen!)]
      if (this.camera)
        this.recorders.push(await mk('camera', 'camera.webm', this.camera))
      this.clock.start()
      for (const r of this.recorders) r.start()
      this.startJournal()
    } catch (err) {
      this.dispatch({
        type: 'fail',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private onTrackEnded(kind: TrackKind): void {
    if (kind === 'camera') {
      this.dispatch({
        type: 'notice',
        message: 'Camera disconnected. Screen recording continues.',
      })
    }
  }

  private journal: JournalWriter | null = null
  private journalTracks: JournalTrack[] = []

  private startJournal(): void {
    if (!canStreamToOpfs()) return
    this.journal = new JournalWriter(this.sessionId)
    this.journalTracks = this.recorders.map((r) => ({
      kind: r.kind,
      file: r.file,
      mime: r.mimeType,
      startOffsetMs: r.startOffset,
      hasAudio: r.hasAudioTrack,
    }))
    this.writeJournal(null)
  }

  private writeJournal(openPauseFrom: number | null): void {
    this.journal?.write({
      version: 1,
      id: this.sessionId,
      startedAt: this.startedAt.toISOString(),
      tracks: this.journalTracks,
      pauses: [...this.clock.pauses],
      openPauseFrom,
      bubble: this.bubble && {
        settings: this.bubble,
        placement: bubblePlacement(this.bubble),
      },
    })
  }

  pause(): void {
    if (this.state.phase !== 'recording') return
    this.clock.pause()
    this.writeJournal(this.clock.offset())
    this.recorders.forEach((r) => r.pause())
    this.dispatch({ type: 'pause' })
  }

  resume(): void {
    if (this.state.phase !== 'paused') return
    this.clock.resume()
    this.writeJournal(null)
    this.recorders.forEach((r) => r.resume())
    this.dispatch({ type: 'resume' })
  }

  async stop(): Promise<SessionOutput | null> {
    if (this.state.phase !== 'recording' && this.state.phase !== 'paused')
      return null
    this.dispatch({ type: 'stop' })
    const durationMs = this.clock.elapsed()
    const pauses = this.clock.finish()
    let tracks: TrackResult[]
    try {
      tracks = await withTimeout(
        Promise.all(this.recorders.map((r) => r.stop())),
        30_000,
        'Saving the recording',
      )
    } catch (err) {
      this.recorders = []
      this.screen = null
      this.camera = null
      this.dispatch({
        type: 'fail',
        message: `Couldn't save the recording: ${err instanceof Error ? err.message : String(err)}`,
      })
      return null
    }
    this.recorders = []
    this.screen = null
    this.camera = null
    // MediaRecorder WebM has no duration or seek index; repair it so every
    // browser can seek it. Best effort: any problem keeps the original.
    const repaired = new Set<string>()
    tracks = await Promise.all(
      tracks.map(async (t) => {
        try {
          const blob = await withTimeout(
            fixWebm(t.blob),
            30_000,
            'Repairing the file',
          )
          if (blob === t.blob) return t
          repaired.add(t.file)
          return { ...t, blob }
        } catch {
          return t
        }
      }),
    )
    const manifest = buildManifest({
      id: this.sessionId,
      createdAt: new Date(),
      durationMs,
      pauses,
      tracks,
      bubble: this.bubble && {
        settings: this.bubble,
        placement: bubblePlacement(this.bubble),
      },
    })
    let persisted = false
    try {
      // Files recorded in memory, or repaired after streaming, are written whole.
      const toWrite = tracks.filter(
        (t) => !canStreamToOpfs() || repaired.has(t.file),
      )
      await Promise.all(
        toWrite.map((t) => persistFile(this.sessionId, t.file, t.blob)),
      )
      await writeJson(this.sessionId, 'session.json', manifest)
      persisted = true
    } catch (err) {
      this.dispatch({
        type: 'notice',
        message: `Couldn't save to browser storage (${err instanceof Error ? err.message : err}). The take is kept in memory until you reload.`,
      })
    }
    if (persisted) await this.journal?.remove()
    this.journal = null
    if (!persisted) rememberSession(manifest, tracks)
    this.output = { manifest, tracks }
    this.dispatch({ type: 'stopped' })
    return this.output
  }

  reset(): void {
    this.output = null
    this.dispatch({ type: 'reset' })
  }
}
