import { describe, expect, it } from 'vitest'
import { MemorySink, ResilientSink, type ChunkSink } from './sink'

const failing = (): ChunkSink => ({
  write: async () => {
    throw new Error('nope')
  },
  close: async () => {
    throw new Error('nope')
  },
})

describe('ResilientSink', () => {
  it('falls back to memory and keeps every chunk when the primary fails immediately', async () => {
    let degraded = 0
    const s = new ResilientSink(failing(), () => degraded++)
    await s.write(new Blob(['ab']))
    await s.write(new Blob(['cd']))
    expect((await s.close()).size).toBe(4)
    expect(degraded).toBe(1)
  })

  it('uses the primary when it works', async () => {
    const s = new ResilientSink(new MemorySink())
    await s.write(new Blob(['abc']))
    expect((await s.close()).size).toBe(3)
  })

  it('does not hang when the primary stalls', async () => {
    const stalled: ChunkSink = {
      write: () => new Promise(() => {}),
      close: () => new Promise(() => {}),
    }
    const s = new ResilientSink(stalled, undefined, 20)
    await s.write(new Blob(['abc']))
    expect((await s.close()).size).toBe(3)
  })
})
