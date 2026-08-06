import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("mobile client architecture", () => {
  it("keeps all service credentials out of the public application contract", () => {
    const source = [
      read("apps/mobile/src/config.ts"),
      read("apps/mobile/app.json"),
      read("apps/mobile/src/auth/auth-provider.tsx"),
    ].join("\n");
    expect(source).not.toMatch(
      /EXPO_PUBLIC_(?:WORKOS_API_KEY|OPENROUTER|CLOUDFLARE|VAULT|RUNNER|SIGNING|SECRET)/,
    );
    expect(source).not.toMatch(/sk_(?:test|live)_|sk-or-v1-/);
  });

  it("uses the public WorkOS OAuth PKCE endpoints", () => {
    const auth = read("apps/mobile/src/auth/auth-provider.tsx");
    expect(auth).toContain("/oauth2/authorize");
    expect(auth).toContain("/oauth2/token");
    expect(auth).toContain("usePKCE: true");
    expect(auth).not.toContain("/user_management/");
  });

  it("uses generic workflow schemas and generic operator routes", () => {
    expect(read("apps/mobile/app/workflow/[type].tsx")).toContain("workflow.inputSchema");
    for (const route of [
      "app/(tabs)/index.tsx",
      "app/(tabs)/agents.tsx",
      "app/(tabs)/history.tsx",
      "app/(tabs)/settings.tsx",
      "app/approvals.tsx",
      "app/connections.tsx",
      "app/actions.tsx",
    ]) {
      expect(read(`apps/mobile/${route}`)).not.toMatch(/repo-analyst|polymancer|swordfish/i);
    }
  });

  it("persists exactly one queued turn with a stable client identity", () => {
    const storage = read("apps/mobile/src/storage/mobile-store.ts");
    const runtime = read("apps/mobile/src/chat/chat-runtime.tsx");
    expect(storage).toContain("singleton INTEGER PRIMARY KEY CHECK (singleton = 1)");
    expect(runtime).toContain("clientTurnId");
    expect(runtime).toContain("getPendingTurn");
  });
});
