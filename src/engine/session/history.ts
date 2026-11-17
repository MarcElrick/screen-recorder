/** Small snapshot history for undo/redo. */
export class History<T> {
  private past: T[] = []
  private future: T[] = []
  constructor(private current: T) {}

  get value(): T {
    return this.current
  }
  get canUndo(): boolean {
    return this.past.length > 0
  }
  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Record a new committed value. */
  push(next: T): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return
    this.past.push(this.current)
    this.current = next
    this.future = []
  }
  undo(): T {
    const prev = this.past.pop()
    if (prev !== undefined) {
      this.future.push(this.current)
      this.current = prev
    }
    return this.current
  }
  redo(): T {
    const next = this.future.pop()
    if (next !== undefined) {
      this.past.push(this.current)
      this.current = next
    }
    return this.current
  }
}
