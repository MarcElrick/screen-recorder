export interface Interval {
  /** ms on the session clock (excludes nothing: raw wall offset from session start). */
  from: number
  to: number
}

/**
 * Shared clock for all tracks. Time is measured with an injectable `now` so it
 * is testable. `elapsed()` excludes paused time; `offset()` is raw time since start.
 */
export class SessionClock {
  private startAt: number | null = null
  private pauseStart: number | null = null
  private pausedTotal = 0
  readonly pauses: Interval[] = []

  constructor(private readonly now: () => number = () => performance.now()) {}

  get started(): boolean {
    return this.startAt !== null
  }

  start(): void {
    if (this.startAt !== null) return
    this.startAt = this.now()
  }

  /** Raw ms since start (includes paused time). */
  offset(): number {
    return this.startAt === null ? 0 : this.now() - this.startAt
  }

  pause(): void {
    if (this.startAt === null || this.pauseStart !== null) return
    this.pauseStart = this.offset()
  }

  resume(): void {
    if (this.pauseStart === null) return
    const to = this.offset()
    this.pauses.push({ from: this.pauseStart, to })
    this.pausedTotal += to - this.pauseStart
    this.pauseStart = null
  }

  /** Recorded ms, excluding paused time. */
  elapsed(): number {
    if (this.startAt === null) return 0
    const open = this.pauseStart === null ? 0 : this.offset() - this.pauseStart
    return this.offset() - this.pausedTotal - open
  }

  /** Close any open pause and return all pause intervals. */
  finish(): Interval[] {
    this.resume()
    return [...this.pauses]
  }
}
