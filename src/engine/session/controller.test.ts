import { beforeEach, describe, expect, it } from 'vitest'
import { SessionClock } from '../recording/clock'
import { MemorySink } from '../storage/sink'
import { SessionController } from './controller'

class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live'
  stop(): void {
    this.readyState = 'ended'
  }
  end(): void {
    this.readyState = 'ended'
    this.dispatchEvent(new Event('ended'))
  }
}
class FakeStream {
  constructor(
    public tracks: FakeTrack[] = [new FakeTrack()],
    private audio = false,
  ) {}
  getTracks = (): FakeTrack[] => this.tracks
  getVideoTracks = (): FakeTrack[] => this.tracks
  getAudioTracks = (): FakeTrack[] => (this.audio ? [new FakeTrack()] : [])
}
const recorders: FakeRecorder[] = []
class FakeRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType = 'video/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  log: string[] = []
  constructor() {
    recorders.push(this)
  }
  start(): void {
    this.state = 'recording'
    this.log.push('start')
    this.ondataavailable?.({ data: new Blob(['abc']) })
  }
  pause(): void {
    this.state = 'paused'
    this.log.push('pause')
  }
  resume(): void {
    this.state = 'recording'
    this.log.push('resume')
  }
  stop(): void {
    this.state = 'inactive'
    this.log.push('stop')
    this.ondataavailable?.({ data: new Blob(['def']) })
    queueMicrotask(() => this.onstop?.())
  }
}

let now = 0
const make = (): SessionController =>
  new SessionController({
    sinkFactory: async () => new MemorySink(),
    clock: () => new SessionClock(() => now),
    id: () => 'take-1',
    wait: async () => {},
  })

beforeEach(() => {
  recorders.length = 0
  now = 0
  ;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder =
    Object.assign(FakeRecorder, {
      isTypeSupported: () => true,
    })
})

describe('SessionController', () => {
  it('records screen + camera together through pause/resume/stop', async () => {
    const c = make()
    c.setScreen(new FakeStream() as unknown as MediaStream)
    c.setCamera(
      new FakeStream([new FakeTrack()], true) as unknown as MediaStream,
    )
    c.setBubble({ corner: 'bottom-right', size: 0.2 })
    await c.start()
    expect(c.state.phase).toBe('recording')
    expect(recorders).toHaveLength(2)
    now = 1000
    c.pause()
    now = 3000
    c.resume()
    now = 4000
    const out = await c.stop()
    expect(
      recorders.every((r) => r.log.join() === 'start,pause,resume,stop'),
    ).toBe(true)
    expect(c.state.phase).toBe('done')
    expect(out!.manifest.durationMs).toBe(2000)
    expect(out!.manifest.pauses).toEqual([{ from: 1000, to: 3000 }])
    expect(out!.manifest.tracks.map((t) => [t.kind, t.sizeBytes])).toEqual([
      ['screen', 6],
      ['camera', 6],
    ])
    expect(out!.manifest.tracks.map((t) => t.hasAudio)).toEqual([false, true])
    expect(out!.manifest.bubble?.settings.corner).toBe('bottom-right')
  })

  it('camera is optional', async () => {
    const c = make()
    c.setScreen(new FakeStream() as unknown as MediaStream)
    await c.start()
    const out = await c.stop()
    expect(out!.manifest.tracks).toHaveLength(1)
  })

  it('stops cleanly and saves the take when sharing ends from the browser bar', async () => {
    const c = make()
    const screen = new FakeStream()
    c.setScreen(screen as unknown as MediaStream)
    await c.start()
    screen.tracks[0].end()
    await new Promise((r) => setTimeout(r, 0))
    expect(c.state.phase).toBe('done')
    expect(c.state.notices.join()).toMatch(/sharing stopped/i)
    expect(c.output?.tracks[0].blob.size).toBe(6)
  })

  it('keeps recording the screen when the camera is unplugged', async () => {
    const c = make()
    const cam = new FakeStream()
    c.setScreen(new FakeStream() as unknown as MediaStream)
    c.setCamera(cam as unknown as MediaStream)
    await c.start()
    cam.tracks[0].end()
    expect(c.state.phase).toBe('recording')
    expect(c.state.notices.join()).toMatch(/camera disconnected/i)
    const out = await c.stop()
    expect(
      out!.manifest.tracks.find((t) => t.kind === 'camera')!.endedEarly,
    ).toBe(true)
    expect(
      out!.manifest.tracks.find((t) => t.kind === 'screen')!.endedEarly,
    ).toBe(false)
  })

  it('cancelling the countdown returns to ready without recording', async () => {
    let release!: () => void
    const c = new SessionController({
      sinkFactory: async () => new MemorySink(),
      wait: () => new Promise<void>((r) => (release = r)),
    })
    c.setScreen(new FakeStream() as unknown as MediaStream)
    const started = c.start({ countdownSeconds: 3 })
    expect(c.state.phase).toBe('countdown')
    c.cancelCountdown()
    release()
    await started
    expect(c.state.phase).toBe('ready')
    expect(recorders).toHaveLength(0)
  })
})
