import { cn } from "@/lib/utils";

export function WorkbenchMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-[0.4rem] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]"
      >
        <span className="font-mono text-[9px] leading-none font-semibold tracking-[-0.08em]">
          A/1
        </span>
        <span className="bg-signal absolute right-1 bottom-1 size-1 rounded-full" />
      </span>
      <span className="min-w-0 leading-none">
        <span className="font-display text-foreground block truncate text-[13px] font-semibold tracking-[-0.01em]">
          Assistant
        </span>
        <span className="text-muted-foreground mt-1 block truncate font-mono text-[9px] tracking-[0.14em] uppercase">
          {compact ? "mk1" : "agent workbench · mk1"}
        </span>
      </span>
    </div>
  );
}
