import { describe, expect, it } from "vitest";

import { isRetiredWorkbenchApiPath } from "./retired-api-paths";

describe("retired workbench API paths", () => {
  it("tombstones incomplete export and demo routes without shadowing supported APIs", () => {
    expect(isRetiredWorkbenchApiPath("/api/workbench/data-export")).toBe(true);
    expect(isRetiredWorkbenchApiPath("/api/workbench/cloudflare-demo-runs/run-1")).toBe(true);
    expect(isRetiredWorkbenchApiPath("/api/workbench/executors/demo-inspect")).toBe(true);
    expect(isRetiredWorkbenchApiPath("/api/workbench/data-exports")).toBe(false);
    expect(isRetiredWorkbenchApiPath("/api/threads")).toBe(false);
  });
});
