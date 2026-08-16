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

  it("uses statically analyzable Expo public environment references", () => {
    const config = read("apps/mobile/src/config.ts");
    for (const name of [
      "EXPO_PUBLIC_WORKBENCH_ORIGIN",
      "EXPO_PUBLIC_WORKOS_CLIENT_ID",
      "EXPO_PUBLIC_WORKOS_ISSUER",
      "EXPO_PUBLIC_EAS_PROJECT_ID",
    ]) {
      expect(config).toContain(`process.env.${name}`);
    }
    expect(config).not.toContain("process.env[name]");
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

  it("renders pack outputs through generic native contracts", () => {
    const run = read("apps/mobile/app/run/[id].tsx");
    const renderers = read("apps/mobile/src/components/generic-renderers.tsx");
    const messages = read("apps/mobile/src/chat/chat-messages.ts");
    expect(run).toContain("artifactRenderers");
    expect(run).toContain("ArtifactRenderer");
    expect(renderers).toContain("MarkdownRenderer");
    expect(renderers).toContain("TableRenderer");
    expect(renderers).toContain("ManagedStateCard");
    expect(messages).toContain('type: "tool-call"');
    expect([run, renderers, messages].join("\n")).not.toMatch(/repo-analyst|polymancer|swordfish/i);
  });

  it("persists exactly one queued turn with a stable client identity", () => {
    const storage = read("apps/mobile/src/storage/mobile-store.ts");
    const runtime = read("apps/mobile/src/chat/chat-runtime.tsx");
    expect(storage).toContain("singleton INTEGER PRIMARY KEY CHECK (singleton = 1)");
    expect(runtime).toContain("clientTurnId");
    expect(runtime).toContain("getPendingTurn");
  });

  it("keeps tenant display resources canonical and local authority bounded", () => {
    const storage = read("apps/mobile/src/storage/mobile-store.ts");
    const provider = read("apps/mobile/src/workbench-provider.tsx");
    expect(storage).not.toContain("CREATE TABLE IF NOT EXISTS display_cache");
    expect(storage).not.toContain("putDisplaySnapshot");
    expect(provider).toContain("WorkbenchClientProvider");
    expect(provider).toContain("workbenchSessionEventInvalidations");
    expect(storage).toContain("DELETE FROM drafts");
    expect(storage).toContain("DELETE FROM pending_turn");
    expect(read("apps/mobile/src/auth/auth-provider.tsx")).toContain(
      "await mobileStore.clearLocalAuthority()",
    );
  });

  it("selects and hydrates existing threads while retaining per-thread drafts", () => {
    const threads = read("apps/mobile/app/threads.tsx");
    const runtime = read("apps/mobile/src/chat/chat-runtime.tsx");
    const composer = read("apps/mobile/src/components/chat-thread.tsx");
    expect(threads).toContain("activate.mutateAsync(threadId)");
    expect(runtime).toContain("createWorkbenchChatController");
    expect(runtime).toContain("controller.acceptSessionEvent(event)");
    expect(runtime).toContain("thread.reset(threadMessagesFromWire(event.messages))");
    expect(composer).toContain("mobileStore.getDraft(threadId)");
    expect(composer).toContain("mobileStore.putDraft(threadId, text)");
  });

  it("refreshes chat authority on reconnect and requests push permission only explicitly", () => {
    const transport = read("apps/mobile/src/chat/chat-transport.ts");
    const workbench = read("apps/mobile/src/workbench-provider.tsx");
    const provider = read("apps/mobile/src/notifications/device-provider.tsx");
    const settings = read("apps/mobile/app/(tabs)/settings.tsx");
    expect(transport).toContain("await input.getConnection()");
    expect(workbench).toContain("mobileStore.getSessionCursor(workspaceId)");
    expect(workbench).toContain("realtime.subscribeSession({ after })");
    expect(provider.slice(provider.indexOf("export function MobileDeviceProvider"))).not.toContain(
      "registerDeviceDelivery(client)",
    );
    expect(settings).toContain('label={notificationBusy ? "Enabling…" : "Enable notifications"}');
  });

  it("keeps native acceptance local, artifact-backed, and credential-free", () => {
    const runner = read("scripts/run-mobile-e2e.ts");
    const evidence = read("scripts/mobile-device-evidence-lib.ts");
    expect(runner).toContain('"--test-output-dir"');
    expect(runner).not.toContain("maestro cloud");
    expect(evidence).toContain('"earlySend"');
    expect(evidence).toContain('"foregroundResume"');
    expect(evidence).toContain("credentialPattern");
  });

  it("uses the shared scrubber and keeps Sentry upload authority build-only", () => {
    const observability = read("apps/mobile/src/observability.ts");
    const config = read("apps/mobile/app.json");
    const metro = read("apps/mobile/metro.config.js");
    const release = read("apps/mobile/scripts/configure-sentry-release.cjs");
    expect(observability).toContain("@assistant-mk1/observability");
    expect(observability).toContain("sendDefaultPii: false");
    expect(config).toContain("@sentry/react-native/expo");
    expect(metro).toContain("getSentryExpoConfig");
    expect(release).toContain("EAS_BUILD_GIT_COMMIT_HASH");
    expect(release).toContain('spawnSync("set-env"');
    expect([observability, config, metro, release].join("\n")).not.toMatch(
      /EXPO_PUBLIC_(?:SENTRY_AUTH_TOKEN|SENTRY_ORG|SENTRY_PROJECT)/,
    );
  });

  it("keeps internal builds store-safe without declaring an unused update channel", () => {
    const config = read("apps/mobile/app.json");
    const eas = read("apps/mobile/eas.json");
    expect(config).toContain('"ITSAppUsesNonExemptEncryption": false');
    expect(eas).not.toContain('"channel"');
  });

  it("ships TestFlight through store distribution without development-device authority", () => {
    const eas = JSON.parse(read("apps/mobile/eas.json"));
    expect(eas.build.testflight).toMatchObject({
      environment: "production",
      distribution: "store",
      autoIncrement: true,
    });
    expect(eas.build.testflight.developmentClient).not.toBe(true);
    expect(eas.submit.testflight.ios).toEqual({ ascAppId: "6801853827" });
  });
});
