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
  /** A camera with video is ready, so a camera-only take is possible. */
  hasCamera: boolean
  error?: string
  /** Non-fatal notices (camera unplugged, sharing stopped, ...). */
  notices: string[]
}

export type SessionEvent =
  | { type: 'screenChosen' }
  | { type: 'screenLost' }
  | { type: 'cameraChosen' }
  | { type: 'cameraLost' }
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
  hasCamera: false,
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
      if (s.phase === 'ready')
        return {
          ...s,
          phase: s.hasCamera ? 'ready' : 'idle',
          hasScreen: false,
        }
      return { ...s, hasScreen: false }
    case 'cameraChosen':
      if (s.phase === 'idle' || s.phase === 'ready' || s.phase === 'error')
        return { ...s, phase: 'ready', hasCamera: true, error: undefined }
      return { ...s, hasCamera: true }
    case 'cameraLost':
      if (s.phase === 'ready')
        return {
          ...s,
          phase: s.hasScreen ? 'ready' : 'idle',
          hasCamera: false,
        }
      return { ...s, hasCamera: false }
    case 'start':
      if (s.phase !== 'ready' && !(s.phase === 'done' && s.hasCamera)) return s
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
        ? { ...s, phase: 'done', hasScreen: false, hasCamera: false }
        : s
    case 'notice':
      return { ...s, notices: [...s.notices, e.message] }
    case 'fail':
      return { ...s, phase: 'error', error: e.message }
    case 'reset':
      return { ...initialState }
  }
}
