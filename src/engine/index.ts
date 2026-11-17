// The engine is framework-free: no Svelte or DOM-framework imports allowed here.
export type { CaptureSource, CaptureKind } from './capture/types'
export type { Compositor, Layer, Placement } from './compositing/types'
export type { Encoder, RecorderState } from './export/types'
export { SessionController } from './session/controller'
export type { SessionOutput } from './session/controller'
export type { SessionState, Phase } from './session/state'
export type { SessionManifest } from './session/manifest'
export { bubblePlacement, DEFAULT_BUBBLE } from './compositing/placement'
export type { BubbleSettings, Corner } from './compositing/placement'
export * from './capture/devices'
export {
  clampPlacement,
  movePlacement,
  nearestCorner,
  placementForCorner,
  resizeFromCorner,
  shapeAspect,
  withShape,
  withWidth,
  MIN_BUBBLE,
  MAX_BUBBLE,
} from './compositing/placement'
export type { BubbleShape } from './compositing/placement'
export { renderFrame, bubbleGeometry } from './compositing/render'
export type { Layout, FrameSource } from './compositing/render'
export * from './timeline/time'
export * from './timeline/editlist'
export { readCompose, withCompose, outputDuration } from './session/compose'
export type { ComposeState, ComposedManifest } from './session/compose'
export { History } from './session/history'
export { SessionPlayer } from './playback/player'
export { planSync } from './playback/sync'
export { RemoteRenderer } from './compositing/remote-renderer'
export { DecodedVideo } from './playback/decoded-video'
export { fixInfiniteDuration } from './playback/duration-fix'
export { decodePeaks } from './playback/waveform'
export {
  listSessions,
  renameSession,
  deleteSession,
  storageUsage,
  sessionLabel,
  loadSession,
  saveManifest,
  readCachedJson,
  writeCachedJson,
  SessionLoadError,
} from './storage/session-store'
export type { LoadedSession, SessionSummary } from './storage/session-store'
export { exportVideo, exportSupported, ExportError } from './export/exporter'
export type {
  ExportFormat,
  ExportOptions,
  ExportResult,
} from './export/exporter'
export * from './export/plan'
export {
  findUnfinished,
  recoverTake,
  discardUnfinished,
} from './session/recovery'
export type { UnfinishedTake } from './session/recovery'
export * from './transcribe'
export * from './timeline/zoom'
