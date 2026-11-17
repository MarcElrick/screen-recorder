import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  SIDEBAR_MIN,
  TIMELINE_MIN,
  clampLayout,
  layoutLimits,
  loadLayout,
  saveLayout,
} from './layout-prefs'

const store = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe('layout prefs', () => {
  it('limits sizes so the preview keeps room', () => {
    expect(layoutLimits(1000, 800)).toEqual({
      sidebarMax: 600,
      timelineMax: 480,
    })
    expect(layoutLimits(300, 100)).toEqual({
      sidebarMax: SIDEBAR_MIN,
      timelineMax: TIMELINE_MIN,
    })
  })
  it('clamps to the limits', () => {
    expect(clampLayout({ sidebar: 50, timeline: 5000 }, 1200, 800)).toEqual({
      sidebar: SIDEBAR_MIN,
      timeline: 480,
    })
  })
  it('round-trips through storage and ignores junk', () => {
    const s = store()
    expect(loadLayout(1200, 800, s)).toEqual(DEFAULT_LAYOUT)
    saveLayout({ sidebar: 420, timeline: 220 }, s)
    expect(loadLayout(1200, 800, s)).toEqual({ sidebar: 420, timeline: 220 })
    s.setItem('rec.compose.layout.v1', '{nope')
    expect(loadLayout(1200, 800, s)).toEqual(DEFAULT_LAYOUT)
    expect(loadLayout(1200, 800, null)).toEqual(DEFAULT_LAYOUT)
  })
  it('does not throw when storage does', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadLayout(1200, 800, bad)).toEqual(DEFAULT_LAYOUT)
    expect(() => saveLayout(DEFAULT_LAYOUT, bad)).not.toThrow()
  })
})
