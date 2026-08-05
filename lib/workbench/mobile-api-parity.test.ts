import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const mobileRoutes = [
  "accounts/route.ts",
  "actions/route.ts",
  "actions/[proposalId]/execute/route.ts",
  "actions/[proposalId]/reconcile/route.ts",
  "agent-packs/[packId]/instantiate/route.ts",
  "agents/route.ts",
  "agents/[agentId]/activate/route.ts",
  "chat-session/route.ts",
  "chat-session/agent-switch/route.ts",
  "chat-session/materialize-turn/route.ts",
  "chat-session/stage-thread/route.ts",
  "chat-session/stream/route.ts",
  "chat-session/threads/route.ts",
  "devices/route.ts",
  "devices/[deviceId]/route.ts",
  "connections/route.ts",
  "history/artifacts/route.ts",
  "history/runs/route.ts",
  "managed-state/route.ts",
  "notification-preferences/route.ts",
  "tools/approvals/route.ts",
  "workspaces/route.ts",
  "workspaces/[workspaceId]/activate/route.ts",
  "workflows/[workflowType]/route.ts",
  "workflows/route.ts",
];

describe("mobile-facing API identity parity", () => {
  it.each(mobileRoutes)(
    "routes %s through shared identity instead of cookie-only auth",
    (route) => {
      const path = resolve(root, "app/api/workbench", route);
      expect(existsSync(path), `${route} must remain a supported client route`).toBe(true);
      expect(readFileSync(path, "utf8")).not.toContain("withAuth(");
    },
  );
});
