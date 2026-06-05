/**
 * LangGraph SDK client factory for browser-facing assistant traffic.
 *
 * The browser normally talks to the local Next `/api` proxy, which forwards to
 * the LangGraph server without exposing server-only configuration. A public
 * LangGraph URL can still be supplied for hosted/platform scenarios.
 */
import { Client } from "@langchain/langgraph-sdk";

export const createClient = () => {
  const apiUrl =
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
    (typeof window !== "undefined" ? new URL("/api", window.location.href).href : "/api");
  return new Client({ apiUrl });
};
