import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PaintClipboardEvent, PaintKeyboardEvent } from "paintcannon";
import { InputElement, TextAreaElement } from "paintcannon";
import { Div } from "paintcannon-react";
import { registry } from "antipattern";

type KeyboardScope = {
  onKeyDown?: (event: PaintKeyboardEvent) => void;
  inputFieldHandlers: Map<InputElement | TextAreaElement, (event: PaintKeyboardEvent) => void>;
  listeners: Set<(event: PaintKeyboardEvent) => void>;
};
type KeyboardInputOptions = {
  target: React.RefObject<InputElement | TextAreaElement | null>;
  onPaste?: (event: PaintClipboardEvent) => void;
};

const KeyboardContext = React.createContext<{
  activeScope: KeyboardScope;
  captureScope: (scope: KeyboardScope) => (() => void) | null;
} | null>(null);
const KeyboardScopeContext = React.createContext<KeyboardScope | null>(null);

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const [rootScope] = useState<KeyboardScope>(() => ({
    inputFieldHandlers: new Map(),
    listeners: new Set(),
  }));
  const activeScopeRef = useRef<KeyboardScope | null>(null);
  const [activeScope, setActiveScope] = useState<KeyboardScope | null>(null);
  useLayoutEffect(() => {
    return () => {
      activeScopeRef.current = null;
    };
  }, []);
  const captureScope = useCallback((scope: KeyboardScope) => {
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
    () => ({ activeScope: activeScope ?? rootScope, captureScope }),
    [activeScope, rootScope, captureScope],
  );
  const handleKeyDown = useCallback(
    (event: PaintKeyboardEvent) => {
      const scope = activeScopeRef.current ?? rootScope;
      scope.onKeyDown?.(event);
      if (event.propagationStopped) return;
      const inputHandler =
        event.target instanceof InputElement || event.target instanceof TextAreaElement
          ? scope.inputFieldHandlers.get(event.target)
          : undefined;
      inputHandler?.(event);
      if (event.propagationStopped) return;
      for (const listener of Array.from(scope.listeners)) {
        listener(event);
      }
      if (
        scope !== rootScope &&
        (activeScopeRef.current !== scope || event.key === "Tab" || !inputHandler)
      ) {
        event.preventDefault();
      }
    },
    [rootScope],
  );

  return React.createElement(
    KeyboardContext.Provider,
    { value: context },
    React.createElement(
      KeyboardScopeContext.Provider,
      { value: rootScope },
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

export function ExclusiveKeyboardScope({
  children,
  onKeyDown,
}: {
  children: React.ReactNode;
  onKeyDown?: (event: PaintKeyboardEvent) => void;
}) {
  const keyboardContext = useContext(KeyboardContext);
  const claimKeyboardScope = keyboardContext?.captureScope;
  const onKeyDownRef = useRef(onKeyDown);
  onKeyDownRef.current = onKeyDown;
  const [keyboardScope] = useState<KeyboardScope>(() => ({
    onKeyDown: event => onKeyDownRef.current?.(event),
    inputFieldHandlers: new Map(),
    listeners: new Set(),
  }));
  const [hasKeyboardScope, setHasKeyboardScope] = useState(false);
  useLayoutEffect(() => {
    if (!claimKeyboardScope)
      throw new Error("ExclusiveKeyboardScope must be used inside KeyboardProvider");
    const releaseKeyboardScope = claimKeyboardScope(keyboardScope);
    if (releaseKeyboardScope === null) return;
    setHasKeyboardScope(true);
    return releaseKeyboardScope;
  }, [claimKeyboardScope, keyboardContext?.activeScope, keyboardScope]);
  if (!hasKeyboardScope) return null;
  return React.createElement(KeyboardScopeContext.Provider, { value: keyboardScope }, children);
}

function useKeyboardImpl(
  onKeyEvent: (event: PaintKeyboardEvent) => void,
  isActive = true,
  options?: KeyboardInputOptions,
): void {
  const context = useContext(KeyboardContext);
  const scope = useContext(KeyboardScopeContext);
  const target = options?.target;
  const enabled = isActive && context?.activeScope === scope;
  const onKeyEventRef = useRef(onKeyEvent);
  onKeyEventRef.current = onKeyEvent;
  const inputRef = useRef({ enabled, onPaste: options?.onPaste });
  inputRef.current = { enabled, onPaste: options?.onPaste };

  useLayoutEffect(() => {
    const element = target?.current;
    if (!element || !scope) return;
    const handleKeyDown = (event: PaintKeyboardEvent) => {
      if (!inputRef.current.enabled) {
        event.preventDefault();
        return;
      }
      onKeyEventRef.current(event);
    };
    const handlePaste = (event: PaintClipboardEvent) => {
      if (!inputRef.current.enabled) {
        event.preventDefault();
        return;
      }
      inputRef.current.onPaste?.(event);
    };
    const handleFocus = () => {
      if (!inputRef.current.enabled) element.blur();
    };
    scope.inputFieldHandlers.set(element, handleKeyDown);
    element.addEventListener("paste", handlePaste);
    element.addEventListener("focus", handleFocus);
    return () => {
      scope.inputFieldHandlers.delete(element);
      element.removeEventListener("paste", handlePaste);
      element.removeEventListener("focus", handleFocus);
    };
  }, [target, scope]);

  useLayoutEffect(() => {
    if (enabled) target?.current?.focus();
    else target?.current?.blur();
  }, [target, enabled]);

  useEffect(() => {
    if (!isActive) return;
    if (!scope) throw new Error("useKeyboard must be used inside KeyboardProvider");
    if (target) return;

    const listener = (event: PaintKeyboardEvent) => onKeyEventRef.current(event);
    scope.listeners.add(listener);
    return () => {
      scope.listeners.delete(listener);
    };
  }, [isActive, scope, target]);
}

export const keyboardDeps = registry({
  useKeyboard: useKeyboardImpl,
});

export function useKeyboard(
  callback: (event: PaintKeyboardEvent) => void,
  isActive = true,
  options?: KeyboardInputOptions,
): void {
  keyboardDeps.useKeyboard(callback, isActive, options);
}
