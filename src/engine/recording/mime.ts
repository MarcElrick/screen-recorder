const WITH_AUDIO = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]
// A video-only stream must not declare an audio codec: Firefox then writes a
// file that won't play.
const VIDEO_ONLY = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]
const AUDIO_ONLY = ['audio/webm;codecs=opus', 'audio/webm']

export function pickMime(
  isSupported: (m: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  tracks: { video: boolean; audio: boolean } = { video: true, audio: true },
): string | undefined {
  const list = !tracks.video
    ? AUDIO_ONLY
    : tracks.audio
      ? WITH_AUDIO
      : VIDEO_ONLY
  return list.find(isSupported)
}
