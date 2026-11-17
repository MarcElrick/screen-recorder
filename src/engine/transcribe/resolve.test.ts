import { describe, expect, it } from 'vitest'
import { resolveEdit } from './resolve'
import type { SessionManifest } from '../session/manifest'

const manifest = {
  version: 1,
  id: 'x',
  createdAt: '',
  durationMs: 5000,
  pauses: [],
  tracks: [],
  bubble: null,
  transcript: {
    version: 1,
    words: [
      { id: 'w0', text: 'Hello', startMs: 0, endMs: 400 },
      { id: 'w1', text: 'um', startMs: 600, endMs: 800 },
      { id: 'w2', text: 'there.', startMs: 1000, endMs: 1500 },
    ],
    deletedWordIds: ['w1'],
  },
} as unknown as SessionManifest

describe('resolveEdit', () => {
  it('returns the manual edit with no transcript', () => {
    const r = resolveEdit({ ...manifest, transcript: undefined } as never, null)
    expect(r.effective.ranges).toEqual([{ startMs: 0, endMs: 5000 }])
    expect(r.captions).toBeNull()
  })
  it('removes deleted words and builds cues from what remains', () => {
    const r = resolveEdit(manifest as never, null)
    expect(r.effective.ranges.length).toBe(2)
    expect(r.cues[0].text).toBe('Hello there.')
    expect(r.captions?.style.enabled).toBe(true)
  })
})
