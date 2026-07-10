import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { usePackWorkflow } from "@/components/workbench/pack-workflow-context";
import { useWorkbenchAgentConnection } from "@/lib/workbench/use-agent-connection";

export const starterSuggestions = [
  {
    title: "Run a readiness check",
    description: "Confirm the chat loop is responding.",
    prompt:
      "Give me a concise readiness check for this chat session. Keep it practical and mention what you can help with next.",
  },
  {
    title: "Plan a project handoff",
    description: "Test a workbench-style planning response.",
    prompt:
      "Help me turn a rough project idea into a short implementation plan with assumptions, risks, and next checks.",
  },
  {
    title: "Test agent behavior",
    description: "Ask for a focused operator-style answer.",
    prompt:
      "Act as a concise operator assistant. List the first three checks you would run before taking action on a new workspace task.",
  },
  {
    title: "Explain a failure",
    description: "Practice debugging from symptoms.",
    prompt:
      "If I tell you a chat message failed or did nothing, what exact facts should we inspect first?",
  },
] as const;

export function ThreadWelcomeLayout({ children }: { children: ReactNode }) {
  const { session } = useWorkbenchAgentConnection();
  const welcome = session?.activeAgent?.behavior.pack?.ui.welcome;
  return (
    <div className="aui-thread-welcome-root my-auto flex grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          <h1 className="aui-thread-welcome-message-inner text-2xl font-semibold">
            {welcome?.title ?? "Hello there!"}
          </h1>
          <p className="aui-thread-welcome-message-inner text-muted-foreground text-lg">
            {welcome?.description ?? "How can I help you today?"}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

export function StarterSuggestionGrid({
  disabled = false,
  onSelect,
}: {
  disabled?: boolean;
  onSelect: (prompt: string) => void | Promise<void>;
}) {
  const { session } = useWorkbenchAgentConnection();
  const workflow = usePackWorkflow();
  const suggestions =
    session?.activeAgent?.behavior.pack?.ui.welcome?.starters ?? starterSuggestions;
  return (
    <div className="aui-thread-welcome-suggestions grid w-full auto-rows-fr gap-2 pb-4 @md:grid-cols-2">
      {suggestions.map((suggestion) => (
        <div
          key={suggestion.title}
          className="aui-thread-welcome-suggestion-display h-full min-w-0 nth-[n+3]:hidden @md:nth-[n+3]:block"
        >
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if ("action" in suggestion) {
                if (suggestion.action.kind === "workflow") {
                  workflow?.openWorkflow(suggestion.action.workflowType);
                  return;
                }
                void onSelect(suggestion.action.prompt);
                return;
              }
              void onSelect(suggestion.prompt);
            }}
            className="aui-thread-welcome-suggestion bg-background hover:bg-muted h-full min-h-20 w-full min-w-0 flex-col items-start justify-start gap-1 overflow-hidden rounded-lg border px-4 py-3 text-start text-sm whitespace-normal transition-colors"
          >
            <span className="aui-thread-welcome-suggestion-text-1 block w-full min-w-0 break-words font-medium whitespace-normal [overflow-wrap:anywhere]">
              {suggestion.title}
            </span>
            <span className="aui-thread-welcome-suggestion-text-2 text-muted-foreground block w-full min-w-0 break-words leading-5 whitespace-normal [overflow-wrap:anywhere]">
              {suggestion.description}
            </span>
          </Button>
        </div>
      ))}
    </div>
  );
}
