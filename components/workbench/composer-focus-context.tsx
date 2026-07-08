"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

type ComposerFocusContextValue = {
  registerComposerInput: (element: HTMLElement | null) => void;
  focusComposer: () => void;
  focusComposerAfterInteraction: () => void;
  focusComposerAfterOverlayClose: () => void;
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
        if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
          const cursorIndex = input.value.length;
          input.setSelectionRange(cursorIndex, cursorIndex);
        }
        return;
      }
      if (performance.now() - startedAt < 2500) {
        window.requestAnimationFrame(tryFocus);
      }
    };
    window.requestAnimationFrame(tryFocus);
  }, []);

  const focusComposerAfterInteraction = useCallback(() => {
    focusComposer();
    window.setTimeout(focusComposer, 0);
    window.setTimeout(focusComposer, 60);
    window.setTimeout(focusComposer, 160);
  }, [focusComposer]);

  const focusComposerAfterOverlayClose = useCallback(() => {
    focusComposer();
    window.setTimeout(focusComposer, 0);
    window.setTimeout(focusComposer, 80);
    window.setTimeout(focusComposer, 180);
    window.setTimeout(focusComposer, 320);
    window.setTimeout(focusComposer, 600);
  }, [focusComposer]);

  const value = useMemo(
    () => ({
      registerComposerInput,
      focusComposer,
      focusComposerAfterInteraction,
      focusComposerAfterOverlayClose,
    }),
    [
      focusComposer,
      focusComposerAfterInteraction,
      focusComposerAfterOverlayClose,
      registerComposerInput,
    ],
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
