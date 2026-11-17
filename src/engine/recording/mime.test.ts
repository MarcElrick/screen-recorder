import { describe, expect, it } from 'vitest'
import { pickMime } from './mime'

describe('pickMime', () => {
  it('prefers vp9 then falls back', () => {
    expect(pickMime(() => true)).toBe('video/webm;codecs=vp9,opus')
    expect(pickMime((m) => m === 'video/webm')).toBe('video/webm')
    expect(pickMime(() => false)).toBeUndefined()
  })

  it('does not declare opus for a video-only stream', () => {
    const picked = pickMime(() => true, { video: true, audio: false })
    expect(picked).toBe('video/webm;codecs=vp9')
    expect(pickMime(() => true, { video: false, audio: true })).toBe(
      'audio/webm;codecs=opus',
    )
  })
})
