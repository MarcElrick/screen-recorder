import { describe, expect, it } from 'vitest'
import { cutOutput, defaultEditList } from '../timeline/editlist'
import { buildCues, cueAt, splitLines, toSrt, toVtt } from './cues'
import { deriveEditList, wordCutRanges, wordIsCutByTimeline } from './cuts'
import { computeEnvelope, snapToSilence } from './envelope'
import { detectFillers, longSilences } from './fillers'
import { readTranscript, wordsFromChunks } from './state'
import type { Word } from './types'

const mk = (text: string, startMs: number, endMs: number, i: number): Word => ({
  id: `w${i}`,
  text,
  startMs,
  endMs,
})
const words: Word[] = [
  mk('Hello', 0, 400, 0),
  mk('um', 600, 800, 1),
  mk('there.', 1000, 1500, 2),
  mk('Next', 3000, 3400, 3),
  mk('slide', 3500, 4000, 4),
]

describe('envelope', () => {
  it('snaps to the quietest window inside the limits', () => {
    // loud everywhere except 500-520ms
    const sr = 1000
    const s = new Float32Array(2000).fill(0.5)
    s.fill(0, 500, 520)
    const env = computeEnvelope(s, sr, 10)
    const at = snapToSilence(env, 560, 120, 0, 2000)
    expect(at).toBeGreaterThanOrEqual(500)
    expect(at).toBeLessThanOrEqual(520)
  })
  it('respects limits and a missing envelope', () => {
    expect(snapToSilence(null, 900, 100, 0, 800)).toBe(800)
    const env = computeEnvelope(new Float32Array(1000).fill(0.1), 1000)
    const at = snapToSilence(env, 500, 400, 450, 550)
    expect(at).toBeGreaterThanOrEqual(450)
    expect(at).toBeLessThanOrEqual(550)
  })
  it('honours the envelope offset', () => {
    const s = new Float32Array(1000).fill(0.5)
    s.fill(0, 100, 120)
    const env = computeEnvelope(s, 1000, 10, 5000)
    const at = snapToSilence(env, 5150, 100, 5000, 6000)
    expect(at).toBeGreaterThanOrEqual(5100)
    expect(at).toBeLessThanOrEqual(5120)
  })
})

describe('word cuts', () => {
  it('merges adjacent deleted words and keeps room around neighbours', () => {
    const cuts = wordCutRanges(words, new Set(['w1', 'w2']), null, 4200)
    expect(cuts).toHaveLength(1)
    expect(cuts[0].startMs).toBeGreaterThanOrEqual(400 + 20)
    expect(cuts[0].endMs).toBeLessThanOrEqual(3000 - 30)
    expect(cuts[0].endMs).toBeGreaterThanOrEqual(1500)
  })
  it('never cuts into a kept word, even with a noisy envelope', () => {
    const env = computeEnvelope(new Float32Array(5000).fill(0.2), 1000)
    const [c] = wordCutRanges(words, new Set(['w1']), env, 4200)
    expect(c.startMs).toBeGreaterThanOrEqual(420)
    expect(c.endMs).toBeLessThanOrEqual(970)
  })
  it('handles deleting the first and last word', () => {
    expect(wordCutRanges(words, new Set(['w0']), null, 4200)[0].startMs).toBe(0)
    const last = wordCutRanges(words, new Set(['w4']), null, 4200)[0]
    expect(last.endMs).toBe(4000)
  })
  it('derives an edit list on top of manual cuts and is reversible', () => {
    const manual = cutOutput(defaultEditList(5000), 4200, 5000)
    const cuts = wordCutRanges(words, new Set(['w1']), null, 5000)
    const eff = deriveEditList(manual, cuts)
    expect(eff.ranges.length).toBeGreaterThan(1)
    expect(eff.ranges[eff.ranges.length - 1].endMs).toBe(4200)
    expect(
      deriveEditList(manual, wordCutRanges(words, new Set(), null, 5000)),
    ).toEqual(manual)
  })
  it('does not remove everything', () => {
    const all = new Set(words.map((w) => w.id))
    const eff = deriveEditList(
      defaultEditList(4200),
      wordCutRanges(words, all, null, 4200),
    )
    expect(eff.ranges.length).toBeGreaterThan(0)
  })
  it('flags words already cut in the timeline', () => {
    const manual = cutOutput(defaultEditList(5000), 500, 900)
    expect(wordIsCutByTimeline(words[1], manual)).toBe(true)
    expect(wordIsCutByTimeline(words[0], manual)).toBe(false)
  })
})

describe('cues', () => {
  const edit = defaultEditList(5000)
  it('groups at sentence ends and long gaps', () => {
    const cues = buildCues(words, new Set(), {}, edit)
    expect(cues.map((c) => c.text)).toEqual(['Hello um there.', 'Next slide'])
  })
  it('drops deleted words and uses edited time after a cut', () => {
    const del = new Set(['w1'])
    const eff = deriveEditList(edit, wordCutRanges(words, del, null, 5000))
    const cues = buildCues(words, del, {}, eff)
    expect(cues[0].text).toBe('Hello there.')
    const next = cues.find((c) => c.text === 'Next slide')!
    expect(next.startMs).toBeLessThan(3000)
    // The cue starts when its first word is heard in the edited video.
    expect(next.startMs).toBeGreaterThan(1000)
  })
  it('splits cues across a large cut', () => {
    const cut = cutOutput(defaultEditList(5000), 450, 3900)
    const cues = buildCues(
      [mk('a', 0, 400, 0), mk('b', 4000, 4400, 1)],
      new Set(),
      {},
      cut,
    )
    expect(cues).toHaveLength(2)
  })
  it('applies text edits and finds cues by time', () => {
    const cues = buildCues(words, new Set(), { w1: 'umm' }, edit)
    expect(cues[0].text).toContain('umm')
    expect(cueAt(cues, 100)?.text).toContain('Hello')
    expect(cueAt(cues, 2500)).toBeNull()
  })
  it('formats SRT and VTT', () => {
    const cues = [{ startMs: 1500, endMs: 3661001, text: 'a <b> & c' }]
    expect(toSrt(cues)).toBe('1\n00:00:01,500 --> 01:01:01,001\na <b> & c\n')
    const vtt = toVtt(cues)
    expect(vtt.startsWith('WEBVTT\n\n00:00:01.500 --> 01:01:01.001\n')).toBe(
      true,
    )
    expect(vtt).toContain('a &lt;b&gt; &amp; c')
  })
  it('splits long text into two balanced lines', () => {
    const lines = splitLines(
      'one two three four five six seven eight nine ten eleven twelve',
    )
    expect(lines).toHaveLength(2)
    expect(Math.abs(lines[0].length - lines[1].length)).toBeLessThan(12)
  })
})

describe('fillers and silences', () => {
  it('groups fillers', () => {
    const g = detectFillers([...words, mk('Um,', 4100, 4200, 5)], {})
    expect(g).toEqual([{ word: 'um', ids: ['w1', 'w5'] }])
  })
  it('finds long silences and keeps a short pause', () => {
    const [g] = longSilences(words, new Set(), 800, 300)
    expect(g.startMs).toBeGreaterThan(1500)
    expect(g.endMs).toBeLessThan(3000)
    expect(g.endMs - g.startMs).toBe(3000 - 1500 - 300)
  })
})

describe('transcript state', () => {
  it('converts chunks to output time and keeps order', () => {
    const w = wordsFromChunks(
      [
        { text: ' Hi', timestamp: [0, 0.5] },
        { text: ' there', timestamp: [0.4, null] },
        { text: ' ', timestamp: [1, 2] },
      ],
      1000,
      60000,
    )
    expect(w.map((x) => x.text)).toEqual(['Hi', 'there'])
    expect(w[0].startMs).toBe(1000)
    expect(w[0].endMs).toBeLessThanOrEqual(w[1].startMs)
  })
  it('reads old and malformed manifests as no transcript', () => {
    const base = { version: 1 } as never
    expect(readTranscript(base)).toBeNull()
    expect(
      readTranscript({
        ...(base as object),
        transcript: { words: 5 },
      } as never),
    ).toBeNull()
  })
  it('normalises a stored transcript', () => {
    const t = readTranscript({
      transcript: {
        version: 1,
        words: [mk('a', 0, 10, 0)],
        deletedWordIds: ['w0', 'nope'],
      },
    } as never)!
    expect(t.deletedWordIds).toEqual(['w0'])
    expect(t.captions.enabled).toBe(true)
    expect(t.silenceCuts).toEqual([])
  })
})
