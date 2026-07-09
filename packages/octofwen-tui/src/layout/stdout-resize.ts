import { useEffect, useRef } from "react";

type ResizeCallback = () => void;

const resizeCallbacks = new Set<ResizeCallback>();
let resizeListenerAttached = false;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;

function emitResize(): void {
	if (resizeTimer !== undefined) return;
	resizeTimer = setTimeout(flushResize, 0);
}

function flushResize(): void {
	resizeTimer = undefined;
	for (const callback of resizeCallbacks) {
		callback();
	}
}

function attachResizeListener(): void {
	if (resizeListenerAttached) return;
	process.stdout.on("resize", emitResize);
	resizeListenerAttached = true;
}

function detachResizeListener(): void {
	if (!resizeListenerAttached || resizeCallbacks.size > 0) return;
	process.stdout.off("resize", emitResize);
	resizeListenerAttached = false;
	if (resizeTimer !== undefined) {
		clearTimeout(resizeTimer);
		resizeTimer = undefined;
	}
}

export function useStdoutResize(callback: ResizeCallback): void {
	const callbackRef = useRef(callback);
	callbackRef.current = callback;

	useEffect(() => {
		const resizeCallback = () => callbackRef.current();
		resizeCallbacks.add(resizeCallback);
		attachResizeListener();
		return () => {
			resizeCallbacks.delete(resizeCallback);
			detachResizeListener();
		};
	}, []);
}
