/** Normalised (0..1) rectangle relative to the output canvas. */
export interface Placement {
  x: number
  y: number
  width: number
  height: number
}

export interface Layer {
  sourceId: string
  placement: Placement
}

/** Combines multiple sources into one output stream. */
export interface Compositor {
  setLayers(layers: Layer[]): void
  readonly output: MediaStream
  dispose(): void
}
