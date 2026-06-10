"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

type ComposerFocusContextValue = {
  registerComposerInput: (element: HTMLElement | null) => void;
  focusComposer: () => void;
};

const ComposerFocusContext = createContext<ComposerFocusContextValue | null>(null);

export function WorkbenchComposerFocusProvider({ children }: { children: ReactNode }) {
  const inputRef = useRef<HTMLElement | null>(null);

  const registerComposerInput = useCallback((element: HTMLElement | null) => {
    inputRef.current = element;
  }, []);

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const value = useMemo(
    () => ({
      registerComposerInput,
      focusComposer,
    }),
    [focusComposer, registerComposerInput],
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
