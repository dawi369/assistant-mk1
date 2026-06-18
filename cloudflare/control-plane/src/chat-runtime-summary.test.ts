import { describe, expect, it } from "vitest";

import { latestThreadForSession } from "./chat-runtime-summary";
import type { Env } from "./types";

describe("chat runtime summary", () => {
  it("selects only active threads for the current runtime session", async () => {
    const queries: string[] = [];
    const env = {
      DB: {
        prepare(query: string) {
          queries.push(query);
          return {
            bind() {
              return {
                first: async () => null,
              };
            },
          };
        },
      },
    } as unknown as Env;

    await latestThreadForSession(
      env,
      { userId: "user_1", workspaceId: "workspace_1" },
      "session_1",
      "thread_1",
    );

    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.includes("status = 'active'"))).toBe(true);
  });
});
