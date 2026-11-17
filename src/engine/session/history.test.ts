import { describe, expect, it } from 'vitest'
import { History } from './history'

describe('History', () => {
  it('undoes and redoes, dropping redo on new pushes', () => {
    const h = new History({ n: 0 })
    h.push({ n: 1 })
    h.push({ n: 2 })
    expect(h.undo()).toEqual({ n: 1 })
    expect(h.redo()).toEqual({ n: 2 })
    h.undo()
    h.push({ n: 9 })
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toEqual({ n: 1 })
  })

  it('ignores no-op pushes', () => {
    const h = new History({ n: 0 })
    h.push({ n: 0 })
    expect(h.canUndo).toBe(false)
  })
})
