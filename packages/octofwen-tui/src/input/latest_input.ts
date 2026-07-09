import { useInput } from "ink";
import { useCallback, useRef } from "react";

export type InkInputHandler = Parameters<typeof useInput>[0];
export type InkInputKey = Parameters<InkInputHandler>[1];
export type InkInputOptions = Parameters<typeof useInput>[1];

export type LatestRef<T> = { current: T };

export function useLatestRef<T>(value: T): LatestRef<T> {
	const ref = useRef(value);
	ref.current = value;
	return ref;
}

export function useLatestInput(
	inputHandler: InkInputHandler,
	options?: InkInputOptions,
): void {
	const inputHandlerRef = useLatestRef(inputHandler);
	useInput(
		useCallback((input: string, key: InkInputKey) => {
			inputHandlerRef.current(input, key);
		}, []),
		options,
	);
}
