import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { PaintKeyboardEvent } from "paintcannon";
import { Div } from "paintcannon-react";
import { registry } from "antipattern";

type KeyboardListener = (event: PaintKeyboardEvent) => void;

type KeyboardScope = {
  parent: KeyboardScope | null;
  depth: number;
  listeners: Set<KeyboardListener>;
};

type KeyboardContextValue = {
  createScope: (parent: KeyboardScope) => KeyboardScope;
  register: (scope: KeyboardScope, listener: KeyboardListener) => () => void;
  registerGlobal: (listener: KeyboardListener) => () => void;
  pushScope: (scope: KeyboardScope) => void;
  popScope: (scope: KeyboardScope) => void;
  subscribeActiveScope: (onChange: () => void) => () => void;
  getActiveScope: () => KeyboardScope;
};

const KeyboardContext = React.createContext<KeyboardContextValue | null>(null);
const KeyboardScopeContext = React.createContext<KeyboardScope | null>(null);

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const baseScopeRef = useRef<KeyboardScope | null>(null);
  if (baseScopeRef.current === null) {
    baseScopeRef.current = { parent: null, depth: 0, listeners: new Set() };
  }
  const baseScope = baseScopeRef.current;
  const mountedScopesRef = useRef(new Set<KeyboardScope>());
  const activeScopeRef = useRef<KeyboardScope>(baseScope);
  const activeSubscribersRef = useRef(new Set<() => void>());
  const globalListenersRef = useRef(new Set<KeyboardListener>());

  const recomputeActiveScope = useCallback(() => {
    let next = baseScope;
    for (const scope of mountedScopesRef.current) {
      if (scope.depth >= next.depth) next = scope;
    }
    if (next === activeScopeRef.current) return;
    activeScopeRef.current = next;
    for (const subscriber of Array.from(activeSubscribersRef.current)) subscriber();
  }, [baseScope]);

  const context = useMemo<KeyboardContextValue>(
    () => ({
      createScope: parent => ({ parent, depth: parent.depth + 1, listeners: new Set() }),
      register: (scope, listener) => {
        scope.listeners.add(listener);
        return () => {
          scope.listeners.delete(listener);
        };
      },
      registerGlobal: listener => {
        globalListenersRef.current.add(listener);
        return () => {
          globalListenersRef.current.delete(listener);
        };
      },
      pushScope: scope => {
        mountedScopesRef.current.add(scope);
        recomputeActiveScope();
      },
      popScope: scope => {
        mountedScopesRef.current.delete(scope);
        recomputeActiveScope();
      },
      subscribeActiveScope: onChange => {
        activeSubscribersRef.current.add(onChange);
        return () => {
          activeSubscribersRef.current.delete(onChange);
        };
      },
      getActiveScope: () => activeScopeRef.current,
    }),
    [baseScope, recomputeActiveScope],
  );

  const handleKeyDown = useCallback((event: PaintKeyboardEvent) => {
    for (const listener of Array.from(activeScopeRef.current.listeners)) listener(event);
    for (const listener of Array.from(globalListenersRef.current)) listener(event);
  }, []);

  return React.createElement(
    KeyboardContext.Provider,
    { value: context },
    React.createElement(
      KeyboardScopeContext.Provider,
      { value: baseScope },
      React.createElement(
        Div,
        {
          onKeyDown: handleKeyDown,
          style: {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
          },
        },
        children,
      ),
    ),
  );
}

export function FocusTrap({ children }: { children: React.ReactNode }) {
  const context = useContext(KeyboardContext);
  const parentScope = useContext(KeyboardScopeContext);
  if (context === null || parentScope === null) {
    throw new Error("FocusTrap must be used inside KeyboardProvider");
  }
  const scope = useMemo(() => context.createScope(parentScope), [context, parentScope]);

  useLayoutEffect(() => {
    context.pushScope(scope);
    return () => context.popScope(scope);
  }, [context, scope]);

  useEffect(() => {
    const containTab = (event: PaintKeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key !== "Tab") return;
      event.preventDefault();
    };
    return context.register(scope, containTab);
  }, [context, scope]);

  return React.createElement(KeyboardScopeContext.Provider, { value: scope }, children);
}

export function useKeyboardScopeActive(): boolean {
  const context = useContext(KeyboardContext);
  const scope = useContext(KeyboardScopeContext);
  if (context === null || scope === null) {
    throw new Error("useKeyboardScopeActive must be used inside KeyboardProvider");
  }
  const subscribe = context.subscribeActiveScope;
  const getSnapshot = useCallback(() => context.getActiveScope() === scope, [context, scope]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

function useKeyboardImpl(callback: (event: PaintKeyboardEvent) => void, isActive = true): void {
  const context = useContext(KeyboardContext);
  const scope = useContext(KeyboardScopeContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!isActive) return;
    if (!context || !scope) throw new Error("useKeyboard must be used inside KeyboardProvider");

    const handleKeyDown = (event: PaintKeyboardEvent) => {
      callbackRef.current(event);
    };
    return context.register(scope, handleKeyDown);
  }, [context, scope, isActive]);
}

function useGlobalKeyboardImpl(callback: (event: PaintKeyboardEvent) => void): void {
  const context = useContext(KeyboardContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!context) throw new Error("useGlobalKeyboard must be used inside KeyboardProvider");

    const handleKeyDown = (event: PaintKeyboardEvent) => {
      callbackRef.current(event);
    };
    return context.registerGlobal(handleKeyDown);
  }, [context]);
}

export const keyboardDeps = registry({
  useKeyboard: useKeyboardImpl,
  useGlobalKeyboard: useGlobalKeyboardImpl,
});

export function useKeyboard(callback: (event: PaintKeyboardEvent) => void, isActive = true): void {
  keyboardDeps.useKeyboard(callback, isActive);
}

export function useGlobalKeyboard(callback: (event: PaintKeyboardEvent) => void): void {
  keyboardDeps.useGlobalKeyboard(callback);
}
