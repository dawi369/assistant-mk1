"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

type ComposerFocusContextValue = {
  registerComposerInput: (element: HTMLElement | null) => void;
  focusComposer: () => void;
  focusComposerAfterInteraction: () => void;
};

const ComposerFocusContext = createContext<ComposerFocusContextValue | null>(null);

export function WorkbenchComposerFocusProvider({ children }: { children: ReactNode }) {
  const inputRef = useRef<HTMLElement | null>(null);
  const focusRequestRef = useRef(0);

  const registerComposerInput = useCallback((element: HTMLElement | null) => {
    inputRef.current = element;
  }, []);

  const focusComposer = useCallback(() => {
    const requestId = ++focusRequestRef.current;
    const startedAt = performance.now();
    const tryFocus = () => {
      if (requestId !== focusRequestRef.current) return;
      const input = inputRef.current;
      if (input && document.contains(input)) {
        input.focus({ preventScroll: true });
        return;
      }
      if (performance.now() - startedAt < 1500) {
        window.requestAnimationFrame(tryFocus);
      }
    };
    window.requestAnimationFrame(tryFocus);
  }, []);

  const focusComposerAfterInteraction = useCallback(() => {
    focusComposer();
    window.setTimeout(focusComposer, 0);
  }, [focusComposer]);

  const value = useMemo(
    () => ({
      registerComposerInput,
      focusComposer,
      focusComposerAfterInteraction,
    }),
    [focusComposer, focusComposerAfterInteraction, registerComposerInput],
  );

  return <ComposerFocusContext.Provider value={value}>{children}</ComposerFocusContext.Provider>;
}

export function useWorkbenchComposerFocus() {
  const value = useContext(ComposerFocusContext);
  if (!value) {
    throw new Error("useWorkbenchComposerFocus must be used inside WorkbenchComposerFocusProvider");
  }
  return value;
}
