/*
 * An async, infinite, pull-based input stream: producers push freely, and consumers pull
 * everything currently buffered — or await at least one push if nothing is buffered.
 */
export class Input<T> {
  private buffered: T[] = [];
  private waiter: ((ts: T[]) => void) | null = null;

  push(t: T): void {
    this.buffered.push(t);
    if (this.waiter != null) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(this.buffered.splice(0));
    }
  }

  take(): T[] {
    return this.buffered.splice(0);
  }

  peek(): readonly T[] {
    return this.buffered;
  }

  async get(): Promise<T[]> {
    if (this.buffered.length > 0) return this.buffered.splice(0);
    return new Promise(resolve => {
      this.waiter = resolve;
    });
  }

  clear(): void {
    this.buffered = [];
  }
}
