import { runSmoke } from "./smoke-utils";

type HealthResponse = {
  ok?: boolean;
  service?: string;
};

type ThreadResponse = {
  thread_id?: string;
  error?: string;
};

const baseUrl = (process.env.LANGGRAPH_RUNTIME_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const token = process.env.LANGGRAPH_PROXY_TOKEN ?? "local-langgraph-proxy-token";

const readJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
};

runSmoke("LangGraph runtime gateway smoke", async () => {
  console.log(`Smoking LangGraph runtime gateway at ${baseUrl}`);

  const health = await readJson<HealthResponse>("/health");
  if (!health.ok || health.service !== "assistant-mk1-langgraph-runtime") {
    throw new Error("runtime gateway health returned the wrong service response");
  }

  const thread = await readJson<ThreadResponse>("/threads", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": token,
    },
    body: "{}",
  });
  if (!thread.thread_id) {
    throw new Error(thread.error ?? "runtime gateway did not create a LangGraph thread");
  }

  console.log(JSON.stringify({ threadId: thread.thread_id }, null, 2));
});

export {};
