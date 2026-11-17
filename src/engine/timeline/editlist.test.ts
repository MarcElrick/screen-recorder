import { describe, expect, it } from 'vitest'
import {
  defaultEditList,
  editedDuration,
  editedToOutput,
  normalizeEditList,
  outputToEdited,
} from './editlist'

describe('EditList', () => {
  it('defaults to one full range', () => {
    expect(defaultEditList(3000).ranges).toEqual([{ startMs: 0, endMs: 3000 }])
  })

  it('maps edited time across cuts', () => {
    const e = {
      version: 1 as const,
      ranges: [
        { startMs: 0, endMs: 1000 },
        { startMs: 2000, endMs: 3000 },
      ],
    }
    expect(editedDuration(e)).toBe(2000)
    expect(editedToOutput(e, 500)).toBe(500)
    expect(editedToOutput(e, 1500)).toBe(2500)
    expect(editedToOutput(e, 9999)).toBe(3000)
    expect(outputToEdited(e, 2500)).toBe(1500)
    expect(outputToEdited(e, 1500)).toBeNull()
  })

  it('normalizes bad input to the default', () => {
    expect(normalizeEditList(undefined, 100).ranges).toHaveLength(1)
    expect(
      normalizeEditList(
        { version: 1, ranges: [{ startMs: 50, endMs: 10 }] },
        100,
      ),
    ).toEqual(defaultEditList(100))
    expect(
      normalizeEditList(
        { version: 1, ranges: [{ startMs: -5, endMs: 500 }] },
        100,
      ).ranges,
    ).toEqual([{ startMs: 0, endMs: 100 }])
  })
})
