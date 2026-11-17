const CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

export function pickMime(
  isSupported: (m: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
): string | undefined {
  return CANDIDATES.find(isSupported)
}
