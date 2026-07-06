import { useInput } from "ink";
import React, {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";

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

	return {
		register(priority: number, id: number) {
			registrations.set(id, { priority, id });
		},
		unregister(id: number) {
			registrations.delete(id);
		},
		getActiveId() {
			let maxPriority = Number.NEGATIVE_INFINITY;
			let activeId: number | null = null;
			for (const registration of registrations.values()) {
				if (registration.priority > maxPriority) {
					maxPriority = registration.priority;
					activeId = registration.id;
				}
			}
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
	callback: Parameters<typeof useInput>[0],
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

	useInput((input, key) => {
		if (key.shift && key.tab) {
			const activeId = context?.getActiveId();
			const myId = idRef.current;
			const willFire = !context || myId === activeId;
			if (willFire) {
				callback(input, key);
			}
		} else {
			callback(input, key);
		}
	});
}
