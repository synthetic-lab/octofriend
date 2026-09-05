import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PaintKeyboardEvent } from "paintcannon";
import { InputElement, TextAreaElement } from "paintcannon";
import { Div } from "paintcannon-react";
import { registry } from "antipattern";

type KeyboardScope = { onClose: () => void };
type KeyboardListener = {
  callback: (event: PaintKeyboardEvent) => void;
  scope: KeyboardScope | null;
};
type KeyboardContextValue = {
  activeScope: KeyboardScope | null;
  register: (listener: KeyboardListener) => () => void;
  capture: (scope: KeyboardScope) => (() => void) | null;
};

const KeyboardContext = React.createContext<KeyboardContextValue | null>(null);
const KeyboardScopeContext = React.createContext<KeyboardScope | null>(null);

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const listenersRef = useRef(new Set<KeyboardListener>());
  const activeScopeRef = useRef<KeyboardScope | null>(null);
  const [activeScope, setActiveScope] = useState<KeyboardScope | null>(null);
  useLayoutEffect(() => {
    return () => {
      activeScopeRef.current = null;
    };
  }, []);
  const register = useCallback((listener: KeyboardListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);
  const capture = useCallback((scope: KeyboardScope) => {
    if (activeScopeRef.current !== null) {
      return activeScopeRef.current === scope ? () => {} : null;
    }
    activeScopeRef.current = scope;
    setActiveScope(scope);
    return () => {
      if (activeScopeRef.current !== scope) return;
      activeScopeRef.current = null;
      setActiveScope(null);
    };
  }, []);
  const context = useMemo(
    () => ({ activeScope, register, capture }),
    [activeScope, register, capture],
  );
  const handleKeyDown = useCallback((event: PaintKeyboardEvent) => {
    const scope = activeScopeRef.current;
    if (scope !== null && event.ctrlKey && event.key === "c") {
      event.preventDefault();
      event.stopPropagation();
      scope.onClose();
      return;
    }
    for (const listener of Array.from(listenersRef.current)) {
      if (listener.scope === scope) listener.callback(event);
    }
    if (
      scope !== null &&
      (activeScopeRef.current !== scope ||
        event.key === "Tab" ||
        !(event.target instanceof InputElement || event.target instanceof TextAreaElement))
    ) {
      event.preventDefault();
    }
  }, []);

  return React.createElement(
    KeyboardContext.Provider,
    { value: context },
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
  );
}

export function ModalKeyboardScope({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const keyboardContext = useContext(KeyboardContext);
  const capture = keyboardContext?.capture;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [scope] = useState<KeyboardScope>(() => ({ onClose: () => onCloseRef.current() }));
  const [captured, setCaptured] = useState(false);
  useLayoutEffect(() => {
    if (!capture) throw new Error("Modal must be used inside KeyboardProvider");
    const release = capture(scope);
    if (release === null) return;
    setCaptured(true);
    return release;
  }, [capture, keyboardContext?.activeScope, scope]);
  if (!captured) return null;
  return React.createElement(KeyboardScopeContext.Provider, { value: scope }, children);
}

export function useKeyboardActive(): boolean {
  const context = useContext(KeyboardContext);
  const scope = useContext(KeyboardScopeContext);
  return !context || context.activeScope === scope;
}

function useKeyboardImpl(callback: (event: PaintKeyboardEvent) => void, isActive = true): void {
  const register = useContext(KeyboardContext)?.register;
  const scope = useContext(KeyboardScopeContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!isActive) return;
    if (!register) throw new Error("useKeyboard must be used inside KeyboardProvider");

    return register({
      callback: event => callbackRef.current(event),
      scope,
    });
  }, [register, isActive, scope]);
}

export const keyboardDeps = registry({
  useKeyboard: useKeyboardImpl,
});

export function useKeyboard(callback: (event: PaintKeyboardEvent) => void, isActive = true): void {
  keyboardDeps.useKeyboard(callback, isActive);
}
