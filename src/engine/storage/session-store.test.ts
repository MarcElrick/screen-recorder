import { expect, it } from 'vitest'
import type { SessionManifest } from '../session/manifest'
import {
  listSessions,
  loadSession,
  rememberSession,
  saveManifest,
} from './session-store'

const manifest = (): SessionManifest => ({
  version: 1,
  id: 'take-mem',
  createdAt: '2026-01-01T00:00:00Z',
  durationMs: 1000,
  pauses: [],
  tracks: [],
  bubble: null,
})

it('lists and loads takes kept in memory (browsers without OPFS)', async () => {
  rememberSession(manifest(), [
    { kind: 'screen', blob: new Blob(['s']) },
    { kind: 'camera', blob: new Blob(['c']) },
  ])
  expect((await listSessions()).map((s) => s.id)).toContain('take-mem')
  const s = await loadSession('take-mem')
  expect(s.screen?.size).toBe(1)
  expect(s.camera?.size).toBe(1)
  await saveManifest('take-mem', { ...manifest(), durationMs: 5 })
  expect((await loadSession('take-mem')).manifest.durationMs).toBe(5)
})
