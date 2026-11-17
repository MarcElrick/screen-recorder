/** Pane sizes in Compose, remembered between visits (best effort). */
export interface LayoutPrefs {
  sidebar: number
  timeline: number
}

export const DEFAULT_LAYOUT: LayoutPrefs = { sidebar: 360, timeline: 190 }
export const SIDEBAR_MIN = 260
export const TIMELINE_MIN = 130
const KEY = 'rec.compose.layout.v1'

const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n)

/** Largest sizes that still leave room for the preview. */
export function layoutLimits(
  width: number,
  height: number,
): { sidebarMax: number; timelineMax: number } {
  return {
    sidebarMax: Math.max(SIDEBAR_MIN, Math.min(720, Math.round(width * 0.6))),
    timelineMax: Math.max(TIMELINE_MIN, Math.round(height * 0.6)),
  }
}

export function clampLayout(
  p: LayoutPrefs,
  width: number,
  height: number,
): LayoutPrefs {
  const { sidebarMax, timelineMax } = layoutLimits(width, height)
  return {
    sidebar: Math.min(Math.max(p.sidebar, SIDEBAR_MIN), sidebarMax),
    timeline: Math.min(Math.max(p.timeline, TIMELINE_MIN), timelineMax),
  }
}

export function loadLayout(
  width: number,
  height: number,
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): LayoutPrefs {
  try {
    const raw = storage?.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<LayoutPrefs>
      if (finite(p.sidebar) && finite(p.timeline))
        return clampLayout(
          { sidebar: p.sidebar, timeline: p.timeline },
          width,
          height,
        )
    }
  } catch {
    /* unreadable: use the defaults */
  }
  return clampLayout(DEFAULT_LAYOUT, width, height)
}

export function saveLayout(
  p: LayoutPrefs,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage blocked: sizes just aren't remembered */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
