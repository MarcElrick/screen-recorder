import { describe, expect, it } from 'vitest'
import { pickMime } from './mime'

describe('pickMime', () => {
  it('prefers vp9 then falls back', () => {
    expect(pickMime(() => true)).toBe('video/webm;codecs=vp9,opus')
    expect(pickMime((m) => m === 'video/webm')).toBe('video/webm')
    expect(pickMime(() => false)).toBeUndefined()
  })
})
