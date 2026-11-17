import {
  DEFAULT_BUBBLE,
  SessionController,
  describeError,
  getCameraAndMic,
  getScreen,
  listDevices,
  supported,
  watchLevel,
  type Corner,
  type DeviceInfo,
  type SessionOutput,
  type SessionState,
} from '../../engine'

export const MIC_OFF = 'off'

/** Svelte-reactive wrapper around the framework-free SessionController. */
export class RecorderStore {
  readonly supported = supported()
  private controller = new SessionController()
  private stopLevel: () => void = () => {}
  private ticker: ReturnType<typeof setInterval> | undefined

  session = $state<SessionState>(this.controller.state)
  elapsedMs = $state(0)
  screenStream = $state<MediaStream | null>(null)
  cameraStream = $state<MediaStream | null>(null)
  cameras = $state<DeviceInfo[]>([])
  mics = $state<DeviceInfo[]>([])
  cameraId = $state('')
  micId = $state(MIC_OFF)
  cameraOn = $state(true)
  level = $state(0)
  corner = $state<Corner>(DEFAULT_BUBBLE.corner)
  size = $state(DEFAULT_BUBBLE.size)
  countdown = $state(true)
  countdownLeft = $state(0)
  message = $state('')
  output = $state<SessionOutput | null>(null)

  constructor() {
    this.controller.subscribe((s) => {
      this.session = s
      if (s.phase === 'recording' || s.phase === 'paused') this.startTicker()
      else this.stopTicker()
    })
  }

  get phase(): SessionState['phase'] {
    return this.session.phase
  }
  get busy(): boolean {
    return ['countdown', 'recording', 'paused', 'stopping'].includes(this.phase)
  }

  private startTicker(): void {
    if (this.ticker) return
    this.ticker = setInterval(
      () => (this.elapsedMs = this.controller.elapsedMs()),
      200,
    )
  }
  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = undefined
    if (this.phase === 'idle' || this.phase === 'ready') this.elapsedMs = 0
  }

  async init(): Promise<void> {
    navigator.mediaDevices?.addEventListener?.(
      'devicechange',
      () => void this.refreshDevices(),
    )
    await this.refreshCamera()
  }

  async refreshDevices(): Promise<void> {
    const d = await listDevices()
    this.cameras = d.cameras
    this.mics = d.mics
  }

  /** (Re)acquire the camera+mic stream used for the bubble and the recording. */
  async refreshCamera(): Promise<void> {
    if (this.busy) return
    this.stopLevel()
    this.level = 0
    this.cameraStream?.getTracks().forEach((t) => t.stop())
    this.cameraStream = null
    this.controller.setCamera(null)
    const wantMic = this.micId !== MIC_OFF
    if (!this.cameraOn && !wantMic) {
      await this.refreshDevices().catch(() => {})
      return
    }
    try {
      const stream = await getCameraAndMic({
        camera: this.cameraOn,
        mic: wantMic,
        cameraId: this.cameraId || undefined,
        micId: wantMic && this.micId ? this.micId : undefined,
      })
      this.cameraStream = stream
      this.controller.setCamera(stream)
      this.stopLevel = watchLevel(stream, (l) => (this.level = l))
      this.message = ''
    } catch (err) {
      this.message = `Camera or microphone unavailable: ${describeError(err)}`
    }
    await this.refreshDevices().catch(() => {})
  }

  async chooseScreen(): Promise<void> {
    try {
      const stream = await getScreen()
      this.screenStream
        ?.getTracks()
        .forEach((t) => t !== stream.getTracks()[0] && t.stop())
      this.screenStream = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (this.screenStream === stream) this.screenStream = null
      })
      this.controller.setScreen(stream)
      this.message = ''
    } catch (err) {
      this.message = `Couldn't share your screen: ${describeError(err)}`
    }
  }

  async start(): Promise<void> {
    this.controller.setBubble(
      this.cameraStream ? { corner: this.corner, size: this.size } : null,
    )
    this.output = null
    const secs = this.countdown ? 3 : 0
    this.countdownLeft = secs
    const tick = setInterval(() => {
      this.countdownLeft = Math.max(0, this.countdownLeft - 1)
    }, 1000)
    try {
      await this.controller.start({ countdownSeconds: secs })
    } finally {
      clearInterval(tick)
      this.countdownLeft = 0
    }
  }
  cancelCountdown(): void {
    this.controller.cancelCountdown()
  }
  pause(): void {
    this.controller.pause()
  }
  resume(): void {
    this.controller.resume()
  }
  async stop(): Promise<void> {
    this.output = await this.controller.stop()
    this.screenStream = null
    this.cameraStream = null
    await this.refreshCamera()
  }
  newTake(): void {
    this.controller.reset()
    this.output = null
  }
}
