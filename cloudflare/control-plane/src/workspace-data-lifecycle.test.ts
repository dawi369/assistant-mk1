import { describe, expect, it, vi } from "vitest";

import { handleExportWorkspaceData, handleWorkspaceDeletionPlan } from "./workspace-data-lifecycle";
import type { AgentIdentity, D1PreparedStatement, Env } from "./types";

const identity: AgentIdentity = {
  scope: { userId: "user-1", workspaceId: "workspace-1" },
  agentId: "agent-1",
};

const membership = (role: "owner" | "member") => ({
  id: "membership-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  role,
  status: "active",
  roles_json: JSON.stringify([role]),
  permissions_json: "[]",
  data_json: "{}",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
});

const makeEnv = (role: "owner" | "member" = "owner") => {
  const queries: string[] = [];
  const bindings: unknown[][] = [];
  const env = {
    ARTIFACTS: {
      put: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(async () => ({
        body: new ReadableStream(),
        arrayBuffer: async () => new TextEncoder().encode("artifact body").buffer,
        httpMetadata: { contentType: "text/plain" },
      })),
    },
    DB: {
      prepare(query: string): D1PreparedStatement {
        queries.push(query);
        let values: unknown[] = [];
        const statement: D1PreparedStatement = {
          bind(...nextValues: unknown[]) {
            values = nextValues;
            bindings.push(nextValues);
            return statement;
          },
          async first<T>() {
            if (query.includes("FROM memberships")) return membership(role) as T;
            return null;
          },
          async all<T>() {
            if (query.includes("FROM control_artifacts")) {
              return {
                results: [
                  {
                    id: "artifact-1",
                    user_id: "user-1",
                    workspace_id: "workspace-1",
                    kind: "report",
                    uri: "artifact://artifact-1",
                    mime_type: "text/plain",
                    storage_provider: "r2",
                    storage_key: "tenants/user-1/workspace-1/artifacts/artifact-1",
                    content_sha256:
                      "9938be87d35f2a7a2b80237e8dc71806b209aaea8252f12c1b12949f61d40476",
                    retention_class: "standard",
                    expires_at: "2026-10-01T00:00:00.000Z",
                    deleted_at: null,
                    data_json: "{}",
                    created_at: "2026-07-01T00:00:00.000Z",
                  },
                ] as T[],
              };
            }
            if (query.includes("FROM control_runs")) {
              return { results: [{ id: "run-1", user_id: values[0] }] as T[] };
            }
            return { results: [] as T[] };
          },
          async run() {
            return { success: true };
          },
        };
        return statement;
      },
      async batch() {
        return [];
      },
    },
  } as unknown as Env;
  return { env, queries, bindings };
};

describe("workspace data lifecycle", () => {
  it("exports only scoped D1 collections and retained R2 blobs for an admin", async () => {
    const { env, queries, bindings } = makeEnv();

    const response = await handleExportWorkspaceData(env, identity);
    const body = (await response.json()) as {
      collections: Record<string, unknown[]>;
      artifactBlobs: Array<{ artifactId: string; contentBase64: string }>;
      excludedSecurityState: string[];
      unsupportedState: string[];
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("workspace-1-export.json");
    expect(body.collections.control_runs).toEqual([{ id: "run-1", user_id: "user-1" }]);
    expect(body.artifactBlobs).toEqual([
      {
        artifactId: "artifact-1",
        storageKey: expect.any(String),
        contentSha256: "9938be87d35f2a7a2b80237e8dc71806b209aaea8252f12c1b12949f61d40476",
        mimeType: "text/plain",
        sizeBytes: 13,
        contentBase64: btoa("artifact body"),
      },
    ]);
    expect(body.excludedSecurityState).toContain("control_triggers.secret_hash");
    expect(body.unsupportedState[0]).toContain("Durable Object");
    const triggerQuery = queries.find((query) => query.includes("FROM control_triggers"));
    expect(triggerQuery).not.toContain("secret_hash");
    expect(bindings.some((values) => values[0] === "user-1" && values[1] === "workspace-1")).toBe(
      true,
    );
  });

  it("returns an exact non-executable deletion inventory", async () => {
    const { env } = makeEnv();

    const response = await handleWorkspaceDeletionPlan(env, identity);
    const body = (await response.json()) as {
      plan: {
        d1RowsByCollection: Record<string, number>;
        r2Objects: number;
        executable: boolean;
        blockers: string[];
      };
    };

    expect(body.plan.d1RowsByCollection.control_runs).toBe(1);
    expect(body.plan.d1RowsByCollection.control_artifacts).toBe(1);
    expect(body.plan.r2Objects).toBe(1);
    expect(body.plan.executable).toBe(false);
    expect(body.plan.blockers).toHaveLength(2);
  });

  it("fails the whole export when retained blob integrity does not match D1", async () => {
    const { env } = makeEnv();
    vi.mocked(env.ARTIFACTS!.get).mockResolvedValueOnce({
      body: new ReadableStream(),
      arrayBuffer: async () => new TextEncoder().encode("tampered").buffer,
      httpMetadata: { contentType: "text/plain" },
    });

    const response = await handleExportWorkspaceData(env, identity);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "artifact_checksum_mismatch:artifact-1",
    });
  });

  it("does not expose exports or deletion inventories to ordinary members", async () => {
    const { env, queries } = makeEnv("member");

    const exportResponse = await handleExportWorkspaceData(env, identity);
    const deletionResponse = await handleWorkspaceDeletionPlan(env, identity);

    expect(exportResponse.status).toBe(403);
    expect(deletionResponse.status).toBe(403);
    expect(queries.filter((query) => !query.includes("FROM memberships"))).toHaveLength(0);
  });
});
