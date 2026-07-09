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
		const buffer = this._buffer;
		const callback = this._callback;
		let index = 0;
		while (index < buffer.length) {
			callback(buffer[index] as T);
			index += 1;
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

export class ThrottledMergeBuffer<T extends object> {
	readonly throttle: number;
	readonly _callback: (value: T) => void;
	_buffer: T | null = null;
	_scheduled: ReturnType<typeof setTimeout> | null = null;

	constructor(throttle: number, callback: (value: T) => void) {
		this.throttle = throttle;
		this._callback = callback;
	}

	emit(value: T): void {
		if (this._buffer === null) {
			this._buffer = value;
		} else {
			Object.assign(this._buffer, value);
		}
		if (this._scheduled) return;

		this._scheduled = setTimeout(() => {
			this.flush();
		}, this.throttle);
	}

	flush(): void {
		if (this._scheduled) {
			clearTimeout(this._scheduled);
			this._scheduled = null;
		}
		const buffer = this._buffer;
		if (buffer === null) return;
		this._buffer = null;
		this._callback(buffer);
	}
}

export function throttledMergeBuffer<T extends object>(
	throttle: number,
	callback: (value: T) => void,
): ThrottledMergeBuffer<T> {
	return new ThrottledMergeBuffer(throttle, callback);
}
