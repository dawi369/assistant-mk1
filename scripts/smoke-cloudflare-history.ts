import {
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
  type TenantIdentity,
} from "./smoke-utils";

type HistoryListResponse<T> = {
  ok?: boolean;
  limit?: number;
  runs?: T[];
  artifacts?: T[];
  error?: string;
};

const { baseUrl, suffix, readJson } = createSmokeContext();

const accountId = `workos-org:history-org-${suffix}`;

const identity: TenantIdentity = {
  userId: `history-user-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(accountId),
  email: `history-${suffix}@example.com`,
  name: "History Smoke User",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read", "workbench:demo"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const requireList = <T>(body: HistoryListResponse<T>, key: "runs" | "artifacts", label: string) => {
  if (!body.ok) throw new Error(`${label} failed: ${body.error ?? "unknown error"}`);
  if (!Array.isArray(body[key])) throw new Error(`${label} did not return a ${key} array`);
  if (body.limit !== 5) throw new Error(`${label} did not echo the requested limit`);
};

runSmoke("Cloudflare history smoke", async () => {
  console.log(`Smoking Cloudflare workbench history at ${baseUrl}`);

  requireList(
    await readJson<HistoryListResponse<unknown>>("/workbench/history/runs?limit=5", identity),
    "runs",
    "run history",
  );
  requireList(
    await readJson<HistoryListResponse<unknown>>("/workbench/history/artifacts?limit=5", identity),
    "artifacts",
    "artifact history",
  );
});
