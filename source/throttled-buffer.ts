export class ThrottledBuffer<T> {
  _buffer: T[] = [];
  _scheduled: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly throttle: number,
    readonly _callback: (t: T) => any,
  ) {}

  emit(t: T) {
    this._buffer.push(t);
    if (this._scheduled) return;

    this._scheduled = setTimeout(() => {
      this.flush();
      this._scheduled = null;
    }, this.throttle);
  }

  flush() {
    for (const el of this._buffer) {
      this._callback(el);
    }
    this._buffer = [];
    if (this._scheduled) {
      clearTimeout(this._scheduled);
      this._scheduled = null;
    }
  }
}

export function throttledBuffer<T>(throttle: number, callback: (t: T) => any) {
  return new ThrottledBuffer(throttle, callback);
}
