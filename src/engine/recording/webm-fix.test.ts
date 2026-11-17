/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixWebm } from './webm-fix'

const fixture = (n: string): Blob =>
  new Blob([readFileSync(new URL(`./fixtures/${n}.webm`, import.meta.url))])

function probe(
  bytes: Uint8Array,
): { duration: number; packets: number } | null {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'webm-'))
    const f = join(dir, 'x.webm')
    writeFileSync(f, bytes)
    const out = execFileSync('ffprobe', [
      '-v',
      'error',
      '-count_packets',
      '-show_entries',
      'format=duration:stream=nb_read_packets',
      '-of',
      'json',
      f,
    ]).toString()
    const j = JSON.parse(out)
    return {
      duration: parseFloat(j.format.duration),
      packets: j.streams.reduce(
        (n: number, s: { nb_read_packets: string }) => n + +s.nb_read_packets,
        0,
      ),
    }
  } catch {
    return null
  }
}

const hasFfprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'])
    return true
  } catch {
    return false
  }
})()

describe('fixWebm', () => {
  for (const name of ['video-only', 'video-audio']) {
    it.skipIf(!hasFfprobe)(
      `adds a duration and keeps every packet (${name})`,
      async () => {
        const original = fixture(name)
        const before = probe(new Uint8Array(await original.arrayBuffer()))
        const fixed = await fixWebm(original)
        const after = probe(new Uint8Array(await fixed.arrayBuffer()))
        expect(before && Number.isNaN(before.duration)).toBe(true)
        expect(after).not.toBeNull()
        expect(after!.duration).toBeGreaterThan(2)
        expect(after!.duration).toBeLessThan(3.2)
        expect(after!.packets).toBe(before!.packets)
      },
    )
  }

  it('contains a Cues element and is idempotent', async () => {
    const once = await fixWebm(fixture('video-audio'))
    const bytes = new Uint8Array(await once.arrayBuffer())
    const hasCues = bytes.some(
      (_, i) =>
        bytes[i] === 0x1c &&
        bytes[i + 1] === 0x53 &&
        bytes[i + 2] === 0xbb &&
        bytes[i + 3] === 0x6b,
    )
    expect(hasCues).toBe(true)
    const twice = await fixWebm(once)
    expect(twice.size).toBe(once.size)
  })

  it('returns garbage input untouched', async () => {
    const junk = new Blob([new Uint8Array([1, 2, 3, 4, 5])])
    expect(await fixWebm(junk)).toBe(junk)
  })
})
