export function sleep(ms: number): Promise<void> {
	return new Promise<void>((resolve) => {
		setTimeout(() => {
			resolve();
		}, ms);
	});
}

export function timeout(ms: number): AbortSignal {
	const controller = new AbortController();
	setTimeout(() => {
		controller.abort();
	}, ms);
	return controller.signal;
}

export class ThrottledBuffer<T> {
	readonly throttle: number;
	readonly _callback: (value: T) => void;
	_buffer: T[] = [];
	_scheduled: ReturnType<typeof setTimeout> | null = null;

	constructor(throttle: number, callback: (value: T) => void) {
		this.throttle = throttle;
		this._callback = callback;
	}

	emit(value: T): void {
		this._buffer.push(value);
		if (this._scheduled) return;

		this._scheduled = setTimeout(() => {
			this.flush();
			this._scheduled = null;
		}, this.throttle);
	}

	flush(): void {
		for (const value of this._buffer) {
			this._callback(value);
		}
		this._buffer = [];
		if (this._scheduled) {
			clearTimeout(this._scheduled);
			this._scheduled = null;
		}
	}
}

export function throttledBuffer<T>(
	throttle: number,
	callback: (value: T) => void,
): ThrottledBuffer<T> {
	return new ThrottledBuffer(throttle, callback);
}
