import { describe, expect, it } from 'vitest'
import {
  initialState,
  reduce,
  type SessionEvent,
  type SessionState,
} from './state'

const run = (
  events: SessionEvent[],
  s: SessionState = initialState,
): SessionState => events.reduce(reduce, s)

describe('session state machine', () => {
  it('cannot start without a screen', () => {
    expect(run([{ type: 'start', countdown: false }]).phase).toBe('idle')
  })

  it('happy path', () => {
    const s = run([
      { type: 'screenChosen' },
      { type: 'start', countdown: false },
      { type: 'pause' },
      { type: 'resume' },
      { type: 'stop' },
      { type: 'stopped' },
    ])
    expect(s.phase).toBe('done')
  })

  it('goes through countdown and can cancel', () => {
    const s = run([
      { type: 'screenChosen' },
      { type: 'start', countdown: true },
    ])
    expect(s.phase).toBe('countdown')
    expect(run([{ type: 'cancelCountdown' }], s).phase).toBe('ready')
    expect(run([{ type: 'countdownDone' }], s).phase).toBe('recording')
  })

  it('ignores invalid transitions', () => {
    const s = run([{ type: 'screenChosen' }])
    expect(run([{ type: 'pause' }], s)).toBe(s)
    expect(run([{ type: 'resume' }], s)).toBe(s)
    expect(run([{ type: 'stop' }], s)).toBe(s)
  })

  it('fail goes to error, and choosing a screen recovers', () => {
    const s = run([{ type: 'fail', message: 'x' }])
    expect(s.phase).toBe('error')
    expect(run([{ type: 'screenChosen' }], s)).toMatchObject({
      phase: 'ready',
      error: undefined,
    })
  })

  it('collects notices and clears them on start', () => {
    let s = run([{ type: 'screenChosen' }, { type: 'notice', message: 'hi' }])
    expect(s.notices).toEqual(['hi'])
    s = run([{ type: 'start', countdown: false }], s)
    expect(s.notices).toEqual([])
  })
})
