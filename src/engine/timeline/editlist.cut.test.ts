import { describe, expect, it } from 'vitest'
import {
  cutOutput,
  defaultEditList,
  editedDuration,
  isUntouched,
  keepOutput,
  outputToEditedSnap,
  removedRanges,
} from './editlist'

const full = defaultEditList(10_000)

describe('cutting and trimming', () => {
  it('cuts a middle section', () => {
    const e = cutOutput(full, 3000, 5000)
    expect(e.ranges).toEqual([
      { startMs: 0, endMs: 3000 },
      { startMs: 5000, endMs: 10_000 },
    ])
    expect(editedDuration(e)).toBe(8000)
    expect(removedRanges(e, 10_000)).toEqual([{ startMs: 3000, endMs: 5000 }])
  })

  it('trims the start and end', () => {
    expect(cutOutput(full, 0, 2000).ranges).toEqual([
      { startMs: 2000, endMs: 10_000 },
    ])
    expect(cutOutput(full, 8000, 10_000).ranges).toEqual([
      { startMs: 0, endMs: 8000 },
    ])
  })

  it('keeps only a selection, and cuts compose', () => {
    expect(keepOutput(full, 2000, 6000).ranges).toEqual([
      { startMs: 2000, endMs: 6000 },
    ])
    const e = cutOutput(cutOutput(full, 1000, 2000), 4000, 5000)
    expect(editedDuration(e)).toBe(8000)
    expect(editedDuration(keepOutput(e, 1500, 4500))).toBe(2000)
  })

  it('never removes everything or leaves slivers', () => {
    expect(cutOutput(full, 0, 10_000)).toBe(full)
    expect(keepOutput(full, 20_000, 30_000)).toBe(full)
    // a 50 ms sliver is dropped, which would leave nothing
    expect(cutOutput(full, 50, 10_000)).toBe(full)
  })

  it('is order independent for the selection ends', () => {
    expect(cutOutput(full, 5000, 3000)).toEqual(cutOutput(full, 3000, 5000))
  })

  it('reports untouched edits', () => {
    expect(isUntouched(full, 10_000)).toBe(true)
    expect(isUntouched(cutOutput(full, 0, 1000), 10_000)).toBe(false)
  })

  it('snaps cut points to the next kept range', () => {
    const e = cutOutput(full, 3000, 5000)
    expect(outputToEditedSnap(e, 2000)).toBe(2000)
    expect(outputToEditedSnap(e, 4000)).toBe(3000)
    expect(outputToEditedSnap(e, 6000)).toBe(4000)
  })
})
