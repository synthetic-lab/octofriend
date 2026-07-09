import React, {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { type InkInputHandler, useLatestInput } from "./latest-input";

declare const priorityBrand: unique symbol;
export type Priority = number & { [priorityBrand]: never };

export const UNCHAINED_PRIORITY: Priority = 0 as Priority;
export const FILE_SUGGESTIONS_PRIORITY: Priority = 1 as Priority;

export type InputPriorityRegistration = {
	priority: number;
	id: number;
};

export type InputPriorityRegistry = {
	register: (priority: number, id: number) => void;
	unregister: (id: number) => void;
	getActiveId: () => number | null;
};

export function createInputPriorityRegistry(): InputPriorityRegistry {
	const registrations = new Map<number, InputPriorityRegistration>();
	let activePriority = Number.NEGATIVE_INFINITY;
	let activeId: number | null = null;

	function recomputeActiveId(): void {
		activePriority = Number.NEGATIVE_INFINITY;
		activeId = null;
		for (const registration of registrations.values()) {
			if (registration.priority > activePriority) {
				activePriority = registration.priority;
				activeId = registration.id;
			}
		}
	}

	return {
		register(priority: number, id: number) {
			registrations.set(id, { priority, id });
			if (activeId === id) {
				if (priority >= activePriority) {
					activePriority = priority;
				} else {
					recomputeActiveId();
				}
				return;
			}

			if (priority > activePriority) {
				activePriority = priority;
				activeId = id;
			}
		},
		unregister(id: number) {
			if (!registrations.delete(id)) return;
			if (activeId === id) recomputeActiveId();
		},
		getActiveId() {
			return activeId;
		},
	};
}

const InputPriorityContext = React.createContext<InputPriorityRegistry | null>(
	null,
);

let nextId = 0;

export function InputPriorityProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const registryRef = useRef<InputPriorityRegistry | null>(null);
	if (registryRef.current == null) {
		registryRef.current = createInputPriorityRegistry();
	}

	const register = useCallback((priority: number, id: number) => {
		registryRef.current?.register(priority, id);
	}, []);

	const unregister = useCallback((id: number) => {
		registryRef.current?.unregister(id);
	}, []);

	const getActiveId = useCallback(
		() => registryRef.current?.getActiveId() ?? null,
		[],
	);

	const value = useMemo(
		() => ({
			register,
			unregister,
			getActiveId,
		}),
		[register, unregister, getActiveId],
	);

	return (
		<InputPriorityContext.Provider value={value}>
			{children}
		</InputPriorityContext.Provider>
	);
}

export function usePriorityInput(
	priority: Priority,
	callback: InkInputHandler,
) {
	const context = useContext(InputPriorityContext);
	const idRef = useRef(nextId++);

	useEffect(() => {
		if (!context) return;
		context.register(priority, idRef.current);
		return () => {
			context.unregister(idRef.current);
		};
	}, [priority, context]);

	useLatestInput(
		useCallback(
			(input, key) => {
				if (!(key.shift && key.tab)) {
					callback(input, key);
					return;
				}

				const activeId = context?.getActiveId();
				const myId = idRef.current;
				if (!context || myId === activeId) {
					callback(input, key);
				}
			},
			[callback, context],
		),
	);
}
