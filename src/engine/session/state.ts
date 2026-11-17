export type Phase =
  | 'idle'
  | 'ready'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'done'
  | 'error'

export interface SessionState {
  phase: Phase
  hasScreen: boolean
  error?: string
  /** Non-fatal notices (camera unplugged, sharing stopped, ...). */
  notices: string[]
}

export type SessionEvent =
  | { type: 'screenChosen' }
  | { type: 'screenLost' }
  | { type: 'start'; countdown: boolean }
  | { type: 'countdownDone' }
  | { type: 'cancelCountdown' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'stopped' }
  | { type: 'notice'; message: string }
  | { type: 'fail'; message: string }
  | { type: 'reset' }

export const initialState: SessionState = {
  phase: 'idle',
  hasScreen: false,
  notices: [],
}

export function reduce(s: SessionState, e: SessionEvent): SessionState {
  switch (e.type) {
    case 'screenChosen':
      if (
        s.phase === 'idle' ||
        s.phase === 'ready' ||
        s.phase === 'error' ||
        s.phase === 'done'
      )
        return { ...s, phase: 'ready', hasScreen: true, error: undefined }
      return s
    case 'screenLost':
      if (s.phase === 'ready') return { ...s, phase: 'idle', hasScreen: false }
      return s
    case 'start':
      if (s.phase !== 'ready') return s
      return {
        ...s,
        phase: e.countdown ? 'countdown' : 'recording',
        notices: [],
      }
    case 'countdownDone':
      return s.phase === 'countdown' ? { ...s, phase: 'recording' } : s
    case 'cancelCountdown':
      return s.phase === 'countdown' ? { ...s, phase: 'ready' } : s
    case 'pause':
      return s.phase === 'recording' ? { ...s, phase: 'paused' } : s
    case 'resume':
      return s.phase === 'paused' ? { ...s, phase: 'recording' } : s
    case 'stop':
      return s.phase === 'recording' || s.phase === 'paused'
        ? { ...s, phase: 'stopping' }
        : s
    case 'stopped':
      return s.phase === 'stopping'
        ? { ...s, phase: 'done', hasScreen: false }
        : s
    case 'notice':
      return { ...s, notices: [...s.notices, e.message] }
    case 'fail':
      return { ...s, phase: 'error', error: e.message }
    case 'reset':
      return { ...initialState }
  }
}
