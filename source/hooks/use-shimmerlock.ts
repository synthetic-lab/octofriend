import { useEffect, useState } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type ShimmerPriority =
  | "root-loading"
  | "root-tool"
  | "explore-subagent-tool"
  | "explore-subagent"
  | "explore-subagent-header";

export const SHIMMER_PRIORITY_ORDER: { [K in ShimmerPriority]: number } = {
  "explore-subagent-tool": 0,
  "explore-subagent": 1,
  "explore-subagent-header": 2,
  "root-tool": 3,
  "root-loading": 4,
};

declare const shimmerBrand: unique symbol;
type ShimmerId = symbol & {
  [shimmerBrand]: never;
};

type ShimmerRegistration = {
  id: ShimmerId;
  priority: ShimmerPriority;
};

type ShimmerlockState = {
  registrations: Array<ShimmerRegistration>;
  register: (id: ShimmerId, priority: ShimmerPriority) => void;
  unregister: (id: ShimmerId) => void;
};

const useShimmerlockStore = create<ShimmerlockState>(set => ({
  registrations: [],
  register: (id, priority) => {
    set(state => ({ registrations: [...state.registrations, { id, priority }] }));
  },
  unregister: id => {
    set(state => ({ registrations: state.registrations.filter(entry => entry.id !== id) }));
  },
}));

function owner(registrations: Array<ShimmerRegistration>): symbol | null {
  let selected: ShimmerRegistration | null = null;
  for (const registration of registrations) {
    if (
      selected == null ||
      SHIMMER_PRIORITY_ORDER[registration.priority] <= SHIMMER_PRIORITY_ORDER[selected.priority]
    ) {
      selected = registration;
    }
  }
  return selected?.id ?? null;
}

export function useShimmerlock(priority: ShimmerPriority): symbol {
  const [id] = useState(() => Symbol() as ShimmerId);
  const { register, unregister } = useShimmerlockStore(
    useShallow(state => ({
      register: state.register,
      unregister: state.unregister,
    })),
  );

  useEffect(() => {
    register(id, priority);
    return () => unregister(id);
  }, [id, priority, register, unregister]);

  return id;
}

export function useShimmerlockOwnershipCheck(lock: symbol): boolean {
  const { registrations } = useShimmerlockStore(
    useShallow(state => ({ registrations: state.registrations })),
  );
  return owner(registrations) === lock;
}
