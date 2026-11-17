/**
 * Repairs WebM files written by MediaRecorder, which have no Duration and no
 * Cues (seek index) because they were produced live. Browsers (Firefox most of
 * all) then can't seek them reliably. We rebuild the Segment with a Duration, a
 * SeekHead and Cues pointing at every keyframe cluster, copying the Tracks and
 * Cluster data untouched.
 */

export const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  Tracks: 0x1654ae6b,
  Cluster: 0x1f43b675,
  Cues: 0x1c53bb6b,
  Attachments: 0x1941a469,
  Chapters: 0x1043a770,
  Tags: 0x1254c367,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
} as const

const SEGMENT_LEVEL = new Set<number>([
  ID.SeekHead,
  ID.Info,
  ID.Tracks,
  ID.Cluster,
  ID.Cues,
  ID.Attachments,
  ID.Chapters,
  ID.Tags,
])

/** Files bigger than this are left alone (we read the whole file into memory). */
export const MAX_FIX_BYTES = 400 * 1024 * 1024

interface Header {
  id: number
  /** Payload size, or -1 if unknown. */
  size: number
  /** Header length in bytes (id + size). */
  hdr: number
}

export function readHeader(b: Uint8Array, pos: number): Header | null {
  if (pos >= b.length) return null
  const first = b[pos]
  let idLen = 1
  while (idLen <= 4 && !(first & (0x80 >> (idLen - 1)))) idLen++
  if (idLen > 4 || pos + idLen >= b.length) return null
  let id = 0
  for (let i = 0; i < idLen; i++) id = id * 256 + b[pos + i]
  const sp = pos + idLen
  const s0 = b[sp]
  let sLen = 1
  while (sLen <= 8 && !(s0 & (0x80 >> (sLen - 1)))) sLen++
  if (sLen > 8 || sp + sLen > b.length) return null
  let size = s0 & (0xff >> sLen)
  let allOnes = size === 0xff >> sLen
  for (let i = 1; i < sLen; i++) {
    size = size * 256 + b[sp + i]
    if (b[sp + i] !== 0xff) allOnes = false
  }
  return { id, size: allOnes ? -1 : size, hdr: idLen + sLen }
}

function uintBytes(id: number): number[] {
  const out: number[] = []
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256)
  return out
}

function size8(n: number): number[] {
  const out = [0x01, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 7, v = n; i >= 1; i--, v = Math.floor(v / 256)) out[i] = v % 256
  return out
}

function uint8(n: number): number[] {
  const out = new Array<number>(8).fill(0)
  for (let i = 7, v = n; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v % 256
  return out
}

function element(id: number, payload: ArrayLike<number>): Uint8Array {
  const head = [...uintBytes(id), ...size8(payload.length)]
  const out = new Uint8Array(head.length + payload.length)
  out.set(head, 0)
  out.set(payload as ArrayLike<number>, head.length)
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

interface ClusterInfo {
  /** Absolute byte range of the cluster payload. */
  start: number
  end: number
  timecode: number
  maxTime: number
  startsWithKeyframe: boolean
}

interface Parsed {
  ebml: Uint8Array
  info: Uint8Array
  tracks: Uint8Array
  clusters: ClusterInfo[]
  videoTrack: number
  timecodeScale: number
}

export function forEachChild(
  b: Uint8Array,
  start: number,
  end: number,
  fn: (h: Header, payloadStart: number) => void,
): void {
  let p = start
  while (p < end) {
    const h = readHeader(b, p)
    if (!h || h.size < 0) return
    // A child running past its parent is the truncated tail of a crashed file.
    if (p + h.hdr + h.size > end) return
    fn(h, p + h.hdr)
    p += h.hdr + h.size
  }
}

export function readUint(b: Uint8Array, s: number, e: number): number {
  let v = 0
  for (let i = s; i < e; i++) v = v * 256 + b[i]
  return v
}

function parseTracks(
  b: Uint8Array,
  s: number,
  e: number,
): { track: number; hasVideo: boolean } {
  let firstTrack = 1
  let video = 0
  let seenFirst = false
  forEachChild(b, s, e, (h, ps) => {
    if (h.id !== ID.TrackEntry) return
    let num = 0
    let type = 0
    forEachChild(b, ps, ps + h.size, (c, cs) => {
      if (c.id === ID.TrackNumber) num = readUint(b, cs, cs + c.size)
      if (c.id === ID.TrackType) type = readUint(b, cs, cs + c.size)
    })
    if (!seenFirst) {
      firstTrack = num
      seenFirst = true
    }
    if (type === 1 && !video) video = num
  })
  return { track: video || firstTrack, hasVideo: video !== 0 }
}

function parse(b: Uint8Array): Parsed | null {
  const eh = readHeader(b, 0)
  if (!eh || eh.id !== ID.EBML || eh.size < 0) return null
  const ebmlEnd = eh.hdr + eh.size
  const sh = readHeader(b, ebmlEnd)
  if (!sh || sh.id !== ID.Segment) return null
  const segStart = ebmlEnd + sh.hdr
  const segEnd = sh.size < 0 ? b.length : Math.min(b.length, segStart + sh.size)

  let info: Uint8Array | null = null
  let tracks: Uint8Array | null = null
  let videoTrack = 1
  let hasVideo = false
  let timecodeScale = 1_000_000
  const clusters: ClusterInfo[] = []

  let p = segStart
  while (p < segEnd) {
    const h = readHeader(b, p)
    if (!h) break
    const ps = p + h.hdr
    let end: number
    if (h.size >= 0) {
      end = Math.min(segEnd, ps + h.size)
    } else {
      // Unknown size (live): runs until the next segment-level element.
      end = ps
      while (end < segEnd) {
        const c = readHeader(b, end)
        if (!c || SEGMENT_LEVEL.has(c.id) || c.size < 0) break
        end += c.hdr + c.size
      }
      end = Math.min(end, segEnd)
    }
    if (h.id === ID.Info) {
      info = b.subarray(ps, end)
      forEachChild(b, ps, end, (c, cs) => {
        if (c.id === ID.TimecodeScale)
          timecodeScale = readUint(b, cs, cs + c.size)
      })
    } else if (h.id === ID.Tracks) {
      tracks = b.subarray(p, end)
      const t = parseTracks(b, ps, end)
      videoTrack = t.track
      hasVideo = t.hasVideo
    } else if (h.id === ID.Cluster) {
      clusters.push(scanCluster(b, ps, end, videoTrack, hasVideo))
    }
    p = end
  }
  if (!info || !tracks || clusters.length === 0) return null
  return {
    ebml: b.subarray(0, ebmlEnd),
    info,
    tracks,
    clusters,
    videoTrack,
    timecodeScale,
  }
}

function scanCluster(
  b: Uint8Array,
  start: number,
  end: number,
  videoTrack: number,
  hasVideo: boolean,
): ClusterInfo {
  let timecode = 0
  let maxTime = 0
  let startsWithKeyframe = false
  let sawVideo = false
  const block = (ps: number, size: number, flagsKey: boolean): void => {
    // track number (vint), int16 timecode, flags
    const t0 = b[ps]
    let tl = 1
    while (tl <= 8 && !(t0 & (0x80 >> (tl - 1)))) tl++
    const track = readUint(b, ps, ps + tl) & ((1 << (7 * tl)) - 1)
    const rel = (b[ps + tl] << 8) | b[ps + tl + 1]
    const relSigned = rel > 0x7fff ? rel - 0x10000 : rel
    maxTime = Math.max(maxTime, timecode + relSigned)
    if (track === videoTrack && !sawVideo) {
      sawVideo = true
      startsWithKeyframe = flagsKey
    }
    void size
  }
  forEachChild(b, start, end, (h, ps) => {
    if (h.id === ID.Timecode) {
      timecode = readUint(b, ps, ps + h.size)
      maxTime = Math.max(maxTime, timecode)
    } else if (h.id === ID.SimpleBlock) {
      const t0 = b[ps]
      let tl = 1
      while (tl <= 8 && !(t0 & (0x80 >> (tl - 1)))) tl++
      block(ps, h.size, (b[ps + tl + 2] & 0x80) !== 0)
    } else if (h.id === ID.BlockGroup) {
      // A Block without a ReferenceBlock sibling is a keyframe.
      let blockAt = -1
      let blockSize = 0
      let hasRef = false
      forEachChild(b, ps, ps + h.size, (c, cs) => {
        if (c.id === ID.Block) {
          blockAt = cs
          blockSize = c.size
        }
        if (c.id === ID.ReferenceBlock) hasRef = true
      })
      if (blockAt >= 0) block(blockAt, blockSize, !hasRef)
    }
  })
  return {
    start,
    end,
    timecode,
    maxTime,
    startsWithKeyframe: sawVideo ? startsWithKeyframe : !hasVideo,
  }
}

function buildInfo(original: Uint8Array, durationTicks: number): Uint8Array {
  const kept: Uint8Array[] = []
  forEachChild(original, 0, original.length, (h, ps) => {
    if (h.id !== ID.Duration)
      kept.push(original.subarray(ps - h.hdr, ps + h.size))
  })
  const dur = new Uint8Array(8)
  new DataView(dur.buffer).setFloat64(0, durationTicks)
  kept.push(element(ID.Duration, dur))
  return element(ID.Info, concat(kept))
}

function seekHead(
  infoPos: number,
  tracksPos: number,
  cuesPos: number,
): Uint8Array {
  const entry = (id: number, pos: number): Uint8Array =>
    element(
      0x4dbb,
      concat([element(0x53ab, uintBytes(id)), element(0x53ac, uint8(pos))]),
    )
  return element(
    ID.SeekHead,
    concat([
      entry(ID.Info, infoPos),
      entry(ID.Tracks, tracksPos),
      entry(ID.Cues, cuesPos),
    ]),
  )
}

function buildCues(
  points: { time: number; track: number; pos: number }[],
): Uint8Array {
  return element(
    ID.Cues,
    concat(
      points.map((c) =>
        element(
          0xbb,
          concat([
            element(0xb3, uint8(c.time)),
            element(
              0xb7,
              concat([element(0xf7, [c.track]), element(0xf1, uint8(c.pos))]),
            ),
          ]),
        ),
      ),
    ),
  )
}

/** Returns a repaired copy, or the original blob if it can't/needn't be fixed. */
export async function fixWebm(blob: Blob): Promise<Blob> {
  if (blob.size === 0 || blob.size > MAX_FIX_BYTES) return blob
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const p = parse(bytes)
    if (!p) return blob
    const maxTime = Math.max(...p.clusters.map((c) => c.maxTime))
    const info = buildInfo(p.info, maxTime)
    const cluster = (c: ClusterInfo): Uint8Array[] => [
      new Uint8Array([...uintBytes(ID.Cluster), ...size8(c.end - c.start)]),
      bytes.subarray(c.start, c.end),
    ]
    const cueClusters = p.clusters.filter(
      (c, i) => i === 0 || c.startsWithKeyframe,
    )
    const seekLen = seekHead(0, 0, 0).length
    const cuesLen = buildCues(
      cueClusters.map(() => ({ time: 0, track: 1, pos: 0 })),
    ).length
    const infoPos = seekLen
    const tracksPos = infoPos + info.length
    const cuesPos = tracksPos + p.tracks.length
    let pos = cuesPos + cuesLen
    const clusterPos = new Map<ClusterInfo, number>()
    for (const c of p.clusters) {
      clusterPos.set(c, pos)
      pos += uintBytes(ID.Cluster).length + 8 + (c.end - c.start)
    }
    const cues = buildCues(
      cueClusters.map((c) => ({
        time: c.timecode,
        track: p.videoTrack,
        pos: clusterPos.get(c)!,
      })),
    )
    const head = concat([
      seekHead(infoPos, tracksPos, cuesPos),
      info,
      p.tracks,
      cues,
    ])
    const segPayloadLen = pos
    const segHead = new Uint8Array([
      ...uintBytes(ID.Segment),
      ...size8(segPayloadLen),
    ])
    return new Blob(
      [
        p.ebml as BlobPart,
        segHead as BlobPart,
        head as BlobPart,
        ...p.clusters.flatMap(cluster),
      ] as BlobPart[],
      { type: blob.type || 'video/webm' },
    )
  } catch {
    return blob
  }
}

/** Media duration (ms) of a WebM file, from its last block; null if unreadable. */
export async function webmDurationMs(blob: Blob): Promise<number | null> {
  try {
    const p = parse(new Uint8Array(await blob.arrayBuffer()))
    if (!p) return null
    const maxTime = Math.max(...p.clusters.map((c) => c.maxTime))
    return Math.round((maxTime * p.timecodeScale) / 1_000_000)
  } catch {
    return null
  }
}
