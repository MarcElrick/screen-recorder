import { ID, forEachChild, readHeader, readUint } from '../recording/webm-fix'

export interface VideoPacket {
  /** Presentation time in µs. */
  ts: number
  key: boolean
  data: Uint8Array
}

export interface DemuxedVideo {
  /** WebCodecs codec string. */
  codec: string
  width: number
  height: number
  packets: VideoPacket[]
}

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

function codecString(codecId: string): string | null {
  if (codecId === 'V_VP8') return 'vp8'
  if (codecId === 'V_VP9') return 'vp09.00.10.08'
  return null
}

/** Extract the first video track's packets from a (MediaRecorder) WebM file. */
export function demuxWebmVideo(b: Uint8Array): DemuxedVideo | null {
  const eh = readHeader(b, 0)
  if (!eh || eh.id !== ID.EBML || eh.size < 0) return null
  const sh = readHeader(b, eh.hdr + eh.size)
  if (!sh || sh.id !== ID.Segment) return null
  const segStart = eh.hdr + eh.size + sh.hdr
  const segEnd = sh.size < 0 ? b.length : Math.min(b.length, segStart + sh.size)

  let scale = 1_000_000
  let trackNo = 0
  let codec: string | null = null
  let width = 0
  let height = 0
  const packets: VideoPacket[] = []

  let p = segStart
  while (p < segEnd) {
    const h = readHeader(b, p)
    if (!h) break
    const ps = p + h.hdr
    let end: number
    if (h.size >= 0) end = Math.min(segEnd, ps + h.size)
    else {
      end = ps
      while (end < segEnd) {
        const c = readHeader(b, end)
        if (!c || SEGMENT_LEVEL.has(c.id) || c.size < 0) break
        end += c.hdr + c.size
      }
    }
    if (h.id === ID.Info) {
      forEachChild(b, ps, end, (c, cs) => {
        if (c.id === ID.TimecodeScale) scale = readUint(b, cs, cs + c.size)
      })
    } else if (h.id === ID.Tracks) {
      forEachChild(b, ps, end, (t, ts) => {
        if (t.id !== ID.TrackEntry || trackNo) return
        let num = 0
        let id = ''
        let w = 0
        let ht = 0
        let isVideo = false
        forEachChild(b, ts, ts + t.size, (c, cs) => {
          if (c.id === ID.TrackNumber) num = readUint(b, cs, cs + c.size)
          else if (c.id === ID.TrackType)
            isVideo = readUint(b, cs, cs + c.size) === 1
          else if (c.id === ID.CodecID)
            id = String.fromCharCode(...b.subarray(cs, cs + c.size))
          else if (c.id === ID.Video) {
            forEachChild(b, cs, cs + c.size, (v, vs) => {
              if (v.id === ID.PixelWidth) w = readUint(b, vs, vs + v.size)
              if (v.id === ID.PixelHeight) ht = readUint(b, vs, vs + v.size)
            })
          }
        })
        if (isVideo) {
          trackNo = num
          codec = codecString(id)
          width = w
          height = ht
        }
      })
    } else if (h.id === ID.Cluster && trackNo) {
      let tc = 0
      const pushBlock = (
        bs: number,
        size: number,
        useFlag: boolean,
        ref: boolean,
      ): void => {
        const t0 = b[bs]
        let tl = 1
        while (tl <= 8 && !(t0 & (0x80 >> (tl - 1)))) tl++
        const track = readUint(b, bs, bs + tl) & ((1 << (7 * tl)) - 1)
        if (track !== trackNo) return
        const rel = (b[bs + tl] << 8) | b[bs + tl + 1]
        const relSigned = rel > 0x7fff ? rel - 0x10000 : rel
        const flags = b[bs + tl + 2]
        const key = useFlag ? (flags & 0x80) !== 0 : !ref
        packets.push({
          ts: Math.round(((tc + relSigned) * scale) / 1000),
          key,
          data: b.subarray(bs + tl + 3, bs + size),
        })
      }
      forEachChild(b, ps, end, (c, cs) => {
        if (c.id === ID.Timecode) tc = readUint(b, cs, cs + c.size)
        else if (c.id === ID.SimpleBlock) pushBlock(cs, c.size, true, false)
        else if (c.id === ID.BlockGroup) {
          let at = -1
          let size = 0
          let ref = false
          forEachChild(b, cs, cs + c.size, (g, gs) => {
            if (g.id === ID.Block) {
              at = gs
              size = g.size
            }
            if (g.id === ID.ReferenceBlock) ref = true
          })
          if (at >= 0) pushBlock(at, size, false, ref)
        }
      })
    }
    p = end
  }
  if (!codec || !packets.length) return null
  packets.sort((a, c) => a.ts - c.ts)
  if (!packets[0].key) return null
  return { codec, width, height, packets }
}
