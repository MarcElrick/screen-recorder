/**
 * MediaRecorder WebM files have no duration or seek index, so some browsers
 * report `duration === Infinity` and can't seek until they've scanned the file.
 * Jumping to a huge time forces that scan; then we go back to the start.
 */
export function fixInfiniteDuration(video: HTMLVideoElement): void {
  const run = (): void => {
    if (video.duration !== Infinity) return
    const done = (): void => {
      video.removeEventListener('durationchange', check)
      video.removeEventListener('timeupdate', check)
      video.currentTime = 0
    }
    const check = (): void => {
      if (Number.isFinite(video.duration)) done()
    }
    video.addEventListener('durationchange', check)
    video.addEventListener('timeupdate', check)
    video.currentTime = 1e101
  }
  if (video.readyState >= 1) run()
  else video.addEventListener('loadedmetadata', run, { once: true })
}
