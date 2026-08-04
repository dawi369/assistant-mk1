"use client";

/**
 * Collapsible reasoning-part renderers for assistant-ui streams.
 *
 * Reasoning text can include transient provider-supplied content. The workbench
 * renders it as an ephemeral disclosure; durable decisions and provenance
 * should still be written through framework state contracts instead.
 */
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useScrollLock, type ReasoningMessagePartComponent } from "@assistant-ui/react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;
const ReasoningPreviewContext = createContext(false);

const reasoningVariants = cva("aui-reasoning-root mb-4 w-full", {
  variants: {
    variant: {
      outline: "rounded-lg border px-3 py-2",
      ghost: "",
      muted: "bg-muted/50 rounded-lg px-3 py-2",
    },
  },
  defaultVariants: {
    variant: "outline",
  },
});

type ReasoningRootProps = Omit<React.ComponentProps<typeof Collapsible>, "open" | "onOpenChange"> &
  VariantProps<typeof reasoningVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
    streaming?: boolean;
  };

function ReasoningRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  streaming,
  children,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const initialOpenRef = useRef(defaultOpen);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled
    ? controlledOpen
    : (userOpen ?? (streaming || initialOpenRef.current));
  const isPreview = streaming === true && isOpen;

  const previousStreamingRef = useRef(streaming);
  useLayoutEffect(() => {
    if (previousStreamingRef.current === streaming) return;
    previousStreamingRef.current = streaming;
    if (!isControlled && userOpen === null && !initialOpenRef.current) {
      lockScroll();
    }
  }, [isControlled, lockScroll, streaming, userOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll();
      if (!isControlled) {
        setUserOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="reasoning-root"
      data-variant={variant}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn("group/reasoning-root", reasoningVariants({ variant, className }))}
      style={
        {
          "--animation-duration": `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      <ReasoningPreviewContext.Provider value={isPreview}>
        {children}
      </ReasoningPreviewContext.Provider>
    </Collapsible>
  );
}

function ReasoningTrigger({
  active,
  duration,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  active?: boolean;
  duration?: number;
}) {
  const durationText = duration ? ` (${duration}s)` : "";

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      className={cn(
        "aui-reasoning-trigger group/trigger text-muted-foreground hover:text-foreground flex max-w-[75%] items-center gap-2 py-1 text-sm transition-colors",
        className,
      )}
      {...props}
    >
      <BrainIcon
        data-slot="reasoning-trigger-icon"
        className="aui-reasoning-trigger-icon size-4 shrink-0"
      />
      <span
        data-slot="reasoning-trigger-label"
        className="aui-reasoning-trigger-label-wrapper relative inline-block leading-none"
      >
        <span>Reasoning{durationText}</span>
        {active ? (
          <span
            aria-hidden
            data-slot="reasoning-trigger-shimmer"
            className="aui-reasoning-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          >
            Reasoning{durationText}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon
        data-slot="reasoning-trigger-chevron"
        className={cn(
          "aui-reasoning-trigger-chevron mt-0.5 size-4 shrink-0",
          "transition-transform duration-(--animation-duration) ease-out",
          "group-data-[state=closed]/trigger:-rotate-90",
          "group-data-[state=open]/trigger:rotate-0",
        )}
      />
    </CollapsibleTrigger>
  );
}

function ReasoningContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  const isPreview = useContext(ReasoningPreviewContext);

  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      className={cn(
        "aui-reasoning-content text-muted-foreground relative overflow-hidden text-sm outline-none",
        "group/collapsible-content ease-out",
        "data-[state=closed]:animate-collapsible-up",
        "data-[state=open]:animate-collapsible-down",
        "data-[state=closed]:fill-mode-forwards",
        "data-[state=closed]:pointer-events-none",
        "data-[state=open]:duration-(--animation-duration)",
        "data-[state=closed]:duration-(--animation-duration)",
        className,
      )}
      {...props}
    >
      {children}
      {isPreview ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-background to-transparent"
        />
      ) : null}
    </CollapsibleContent>
  );
}

function ReasoningText({ className, children, ...props }: React.ComponentProps<"div">) {
  const isPreview = useContext(ReasoningPreviewContext);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPreview) return;
    const scrollElement = scrollRef.current;
    const contentElement = contentRef.current;
    if (!scrollElement || !contentElement) return;

    let pinned = true;
    const pinToBottom = () => {
      if (pinned) scrollElement.scrollTop = scrollElement.scrollHeight;
    };
    const handleScroll = () => {
      pinned =
        Math.abs(
          scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight,
        ) <= 1;
    };

    pinToBottom();
    scrollElement.addEventListener("scroll", handleScroll);
    const observer = new ResizeObserver(pinToBottom);
    observer.observe(contentElement);
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [isPreview]);

  return (
    <div
      ref={scrollRef}
      data-slot="reasoning-text"
      className={cn(
        "relative z-0 max-h-64 overflow-y-auto ps-6 pt-2 pb-2 leading-relaxed text-pretty",
        "transition-[transform,opacity] duration-(--animation-duration) motion-reduce:transition-none",
        "group-data-[state=open]/collapsible-content:animate-in group-data-[state=closed]/collapsible-content:animate-out",
        "group-data-[state=open]/collapsible-content:fade-in-0 group-data-[state=closed]/collapsible-content:fade-out-0",
        className,
      )}
      {...props}
    >
      <div ref={contentRef} className="space-y-4">
        {children}
      </div>
    </div>
  );
}

const ReasoningImpl: ReasoningMessagePartComponent = () => <MarkdownText />;
const Reasoning = memo(ReasoningImpl) as unknown as ReasoningMessagePartComponent;
Reasoning.displayName = "Reasoning";

export { Reasoning, ReasoningRoot, ReasoningTrigger, ReasoningContent, ReasoningText };
