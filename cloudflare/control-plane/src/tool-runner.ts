import type { ExecutionMode } from "./types";

export const cloudflareInlineRunnerTransport = "cloudflare_inline";

export type ToolRunnerTransport = typeof cloudflareInlineRunnerTransport;

export type ToolRunnerSource = "admin" | "approval" | "model" | "demo-compat";

export type ToolRunnerMetadata = {
  transport: ToolRunnerTransport;
  adapterVersion: string;
  source: ToolRunnerSource;
};

export type ToolAdapterMetadata = {
  toolName: string;
  adapterVersion: string;
  supportedExecutionModes: ExecutionMode[];
  transport: ToolRunnerTransport;
};

export const runnerMetadataFor = (
  adapter: ToolAdapterMetadata,
  source: ToolRunnerSource,
): ToolRunnerMetadata => ({
  transport: adapter.transport,
  adapterVersion: adapter.adapterVersion,
  source,
});
