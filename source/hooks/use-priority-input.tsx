import React, { useContext, useEffect, useMemo, useRef, useCallback } from "react";
import { useInput } from "ink";

declare const priorityBrand: unique symbol;
export type Priority = number & { [priorityBrand]: never };

export const UNCHAINED_PRIORITY: Priority = 0 as Priority;
export const FILE_SUGGESTIONS_PRIORITY: Priority = 1 as Priority;

type InputPriorityRegistration = {
  priority: number;
  id: number;
};

type InputPriorityContextValue = {
  register: (priority: number, id: number) => void;
  unregister: (id: number) => void;
  getActiveId: () => number | null;
};

const InputPriorityContext = React.createContext<InputPriorityContextValue | null>(null);

let nextId = 0;

export function InputPriorityProvider({ children }: { children: React.ReactNode }) {
  const registrationsRef = useRef<Map<number, InputPriorityRegistration>>(new Map());

  const register = useCallback((priority: number, id: number) => {
    registrationsRef.current.set(id, { priority, id });
  }, []);

  const unregister = useCallback((id: number) => {
    registrationsRef.current.delete(id);
  }, []);

  const getActiveId = useCallback(() => {
    let maxPriority = -Infinity;
    let activeId: number | null = null;
    for (const reg of registrationsRef.current.values()) {
      if (reg.priority > maxPriority) {
        maxPriority = reg.priority;
        activeId = reg.id;
      }
    }
    return activeId;
  }, []);

  const value = useMemo(
    () => ({
      register,
      unregister,
      getActiveId,
    }),
    [register, unregister, getActiveId],
  );

  return <InputPriorityContext.Provider value={value}>{children}</InputPriorityContext.Provider>;
}

export function usePriorityInput(priority: Priority, callback: Parameters<typeof useInput>[0]) {
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
