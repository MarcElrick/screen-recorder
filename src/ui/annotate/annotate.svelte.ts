import {
  ALIGN_VERSION,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_MODEL,
  SessionLoadError,
  SpeechModel,
  alignWords,
  listSessions,
  loadSession,
  outputDuration,
  prepareAudio,
  readCachedJson,
  readTranscript,
  saveManifest,
  speech,
  trackExtent,
  withTranscript,
  writeCachedJson,
  type Envelope,
  type LoadedSession,
  type ModelId,
  type ModelState,
  type SessionSummary,
  type TranscriptState,
} from '../../engine'

export type Phase =
  | 'loading'
  | 'empty'
  | 'no-audio'
  | 'unsupported'
  | 'ready'
  | 'working'
  | 'done'

/**
 * The Annotate step only makes the transcript: pick a model, download it (it
 * is normally already cached), and run it. Editing words and captions
 * happens in Compose.
 */
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
  private envelope: Envelope | null = null

  private unsub: (() => void) | null = null
  private saveChain: Promise<void> = Promise.resolve()
  private abort = false

  constructor() {
    this.unsub = speech.subscribe((s) => (this.modelState = s))
  }

  destroy(): void {
    this.unsub?.()
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
    this.sessionId = id
    this.error = ''
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
      this.transcript = readTranscript(s.manifest)
      this.envelope = await readCachedJson<Envelope>(id, 'envelope.json')
      // Transcripts made with an older alignment are re-aligned once.
      if (
        this.transcript &&
        (this.transcript.alignVersion ?? 0) < ALIGN_VERSION &&
        this.envelope
      ) {
        const shift = this.transcript.shiftMs ?? 0
        const aligned = alignWords(
          $state.snapshot(this.transcript.words) as TranscriptState['words'],
          this.envelope,
        )
        this.transcript.words = shift
          ? aligned.map((w) => ({
              ...w,
              startMs: Math.max(0, w.startMs + shift),
              endMs: Math.max(1, w.endMs + shift),
            }))
          : aligned
        this.transcript.aligned = true
        this.transcript.alignVersion = ALIGN_VERSION
        void this.persist()
      }
      this.phase = this.transcript ? 'done' : 'ready'
    } catch (e) {
      this.session = null
      this.error =
        e instanceof SessionLoadError
          ? e.message
          : 'Something went wrong opening this take.'
      this.phase = 'ready'
    }
  }

  get total(): number {
    return this.session ? outputDuration(this.session.manifest) : 0
  }
  /** Where the camera/mic file starts on the output timeline. */
  get audioStart(): number {
    const m = this.session?.manifest
    const cam = m?.tracks.find((t) => t.kind === 'camera')
    return m && cam ? trackExtent(m.pauses, cam).start : 0
  }

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
      await this.persist()
      this.phase = 'done'
    } catch (e) {
      if (this.abort) return
      this.error = e instanceof Error ? e.message : String(e)
      this.phase = this.transcript ? 'done' : 'ready'
    } finally {
      this.step = ''
    }
  }

  cancel(): void {
    this.abort = true
    speech.cancel()
    this.phase = this.transcript ? 'done' : 'ready'
    this.step = ''
  }

  /** Throw the transcript away (the original recording is untouched). */
  async discard(): Promise<void> {
    this.transcript = null
    await this.persist()
    this.phase = 'ready'
  }

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
