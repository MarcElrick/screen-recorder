/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demuxWebmVideo } from './webm-demux'

const load = (n: string): Uint8Array =>
  new Uint8Array(
    readFileSync(new URL(`../recording/fixtures/${n}.webm`, import.meta.url)),
  )

describe('demuxWebmVideo', () => {
  for (const n of ['video-only', 'video-audio']) {
    it(`extracts ordered video packets starting at a keyframe (${n})`, () => {
      const v = demuxWebmVideo(load(n))!
      expect(v.codec).toBe('vp8')
      expect(v.width).toBe(320)
      expect(v.height).toBe(180)
      expect(v.packets.length).toBeGreaterThan(20)
      expect(v.packets[0].key).toBe(true)
      for (let i = 1; i < v.packets.length; i++)
        expect(v.packets[i].ts).toBeGreaterThanOrEqual(v.packets[i - 1].ts)
      expect(v.packets.every((p) => p.data.length > 0)).toBe(true)
    })
  }

  it('returns null for junk', () => {
    expect(demuxWebmVideo(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})
