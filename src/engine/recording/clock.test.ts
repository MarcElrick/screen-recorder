import { describe, expect, it } from 'vitest'
import { SessionClock } from './clock'

describe('SessionClock', () => {
  it('excludes paused time from elapsed and records pause intervals', () => {
    let t = 1000
    const c = new SessionClock(() => t)
    c.start()
    t = 1500
    expect(c.elapsed()).toBe(500)
    c.pause()
    t = 2500
    expect(c.elapsed()).toBe(500)
    c.resume()
    t = 3000
    expect(c.elapsed()).toBe(1000)
    expect(c.offset()).toBe(2000)
    expect(c.pauses).toEqual([{ from: 500, to: 1500 }])
  })

  it('finish closes an open pause', () => {
    let t = 0
    const c = new SessionClock(() => t)
    c.start()
    t = 100
    c.pause()
    t = 400
    expect(c.finish()).toEqual([{ from: 100, to: 400 }])
  })

  it('ignores pause before start and double pause', () => {
    let t = 0
    const c = new SessionClock(() => t)
    c.pause()
    c.start()
    t = 10
    c.pause()
    t = 20
    c.pause()
    c.resume()
    expect(c.pauses).toEqual([{ from: 10, to: 20 }])
  })
})
