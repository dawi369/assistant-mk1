"use client";

/**
 * Client runtime bridge between assistant-ui and LangGraph.
 *
 * This component creates the LangGraph SDK client, converts assistant-ui message
 * streams into LangGraph runs, and provides the runtime to the thread UI. It
 * should stay provider-agnostic; model credentials and graph logic live on the
 * server side.
 */
import { useMemo, type ReactNode } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  unstable_createLangGraphStream,
  useLangGraphRuntime,
  type LangChainMessage,
} from "@assistant-ui/react-langgraph";

import { createClient } from "@/lib/chatApi";
import { Thread } from "@/components/assistant-ui/thread";
import { createWorkbenchThreadListAdapter } from "@/lib/workbench/chat-thread-list-adapter";

const ASSISTANT_ID = process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID!;

export function Assistant({ children }: { children?: ReactNode }) {
  const client = useMemo(() => createClient(), []);
  const createThread = useMemo(
    () => async () => {
      const { thread_id } = await client.threads.create();
      return { thread_id };
    },
    [client],
  );
  const threadListAdapter = useMemo(
    () => createWorkbenchThreadListAdapter({ createThread }),
    [createThread],
  );
  const stream = useMemo(
    () =>
      unstable_createLangGraphStream({
        client,
        assistantId: ASSISTANT_ID,
      }),
    [client],
  );

  const runtime = useLangGraphRuntime({
    unstable_allowCancellation: true,
    stream,
    unstable_threadListAdapter: threadListAdapter,
    create: async () => {
      const { thread_id } = await client.threads.create();
      return { externalId: thread_id };
    },
    load: async (externalId) => {
      const state = await client.threads.getState<{
        messages: LangChainMessage[];
      }>(externalId);
      return {
        messages: state.values?.messages ?? [],
        interrupts: state.tasks?.[0]?.interrupts,
      };
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
      <Thread />
    </AssistantRuntimeProvider>
  );
}
