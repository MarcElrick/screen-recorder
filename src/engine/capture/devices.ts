export interface DeviceInfo {
  id: string
  label: string
}

export interface Devices {
  cameras: DeviceInfo[]
  mics: DeviceInfo[]
}

export function supported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

export async function listDevices(): Promise<Devices> {
  const all = await navigator.mediaDevices.enumerateDevices()
  const map = (kind: MediaDeviceKind, fallback: string): DeviceInfo[] =>
    all
      .filter((d) => d.kind === kind && d.deviceId)
      .map((d, i) => ({
        id: d.deviceId,
        label: d.label || `${fallback} ${i + 1}`,
      }))
  return {
    cameras: map('videoinput', 'Camera'),
    mics: map('audioinput', 'Microphone'),
  }
}

export function getScreen(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
}

export function getCameraAndMic(opts: {
  cameraId?: string
  micId?: string
  camera: boolean
  mic: boolean
}): Promise<MediaStream> {
  return getCameraAndMicOnce(opts).catch(async (err) => {
    // A missing or blocked camera must not take the microphone down with it.
    if (opts.camera && opts.mic)
      return getCameraAndMicOnce({ ...opts, camera: false })
    throw err
  })
}

function getCameraAndMicOnce(opts: {
  cameraId?: string
  micId?: string
  camera: boolean
  mic: boolean
}): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: opts.camera
      ? {
          deviceId: opts.cameraId ? { exact: opts.cameraId } : undefined,
          width: { ideal: 1280 },
        }
      : false,
    audio: opts.mic
      ? {
          deviceId: opts.micId ? { exact: opts.micId } : undefined,
          echoCancellation: true,
        }
      : false,
  })
}

/** Poll an AnalyserNode for a 0..1 level. Returns a stop function. */
export function watchLevel(
  stream: MediaStream,
  onLevel: (level: number) => void,
): () => void {
  if (stream.getAudioTracks().length === 0) return () => {}
  const ctx = new AudioContext()
  // Browsers may start the context suspended; the meter stays flat until resumed.
  void ctx.resume()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Uint8Array(analyser.fftSize)
  let raf = 0
  const tick = (): void => {
    analyser.getByteTimeDomainData(buf)
    let peak = 0
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
    onLevel(Math.min(1, peak / 64))
    raf = requestAnimationFrame(tick)
  }
  tick()
  return () => {
    cancelAnimationFrame(raf)
    void ctx.close()
  }
}

export function describeError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError')
    return 'Permission was denied or the picker was dismissed.'
  if (name === 'NotFoundError') return 'No matching device was found.'
  if (name === 'NotReadableError') return 'The device is in use by another app.'
  return err instanceof Error ? err.message : 'Something went wrong.'
}
