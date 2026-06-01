import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ArtifactRef, Id, TenantScope } from "@/lib/agent-framework/contracts";
import type {
  AgentFrameworkDataClient,
  ArtifactMetadataCreateInput,
  AuditEventAppendInput,
  DecisionRecordCreateInput,
  LedgerEntryAppendInput,
  ManagedStatePatchInput,
  RunCreateInput,
  RunUpdateStatusInput,
  ToolCallRecordFinishedInput,
  ToolCallRecordStartedInput,
  WorkflowIntentCreateInput,
  WorkflowIntentUpdateStatusInput,
  WorkspaceContext,
} from "@/lib/agent-framework/data-client";
import type {
  AgentRecord,
  ArtifactMetadataRecord,
  AuditEventRecord,
  DecisionRecordEntity,
  LedgerEntryRecord,
  ManagedStateRecord,
  MembershipRecord,
  RunRecord,
  ThreadRecord,
  ToolCallRecord,
  UserRecord,
  WorkflowIntentRecord,
  WorkspaceRecord,
} from "@/lib/agent-framework/db-contracts";

export const DEMO_SCOPE: TenantScope = {
  userId: "fixture-user",
  workspaceId: "fixture-workspace",
};

export const DEMO_AGENT_ID = "fixture-agent";
export const DEFAULT_WORKBENCH_STORE_PATH = ".assistant-mk1/local-store.json";

export type DemoStore = {
  users: UserRecord[];
  workspaces: WorkspaceRecord[];
  memberships: MembershipRecord[];
  agents: AgentRecord[];
  threads: ThreadRecord[];
  workflowIntents: WorkflowIntentRecord[];
  runs: RunRecord[];
  toolCalls: ToolCallRecord[];
  artifacts: ArtifactMetadataRecord[];
  decisions: DecisionRecordEntity[];
  auditEvents: AuditEventRecord[];
  managedState: ManagedStateRecord[];
  ledger: LedgerEntryRecord[];
  latestRunIds: Record<string, Id>;
  counter: number;
  latestRunId?: Id;
};

export type RunOutputLinksInput = {
  runId: Id;
  artifactRef?: ArtifactRef;
  decisionRecordId?: Id;
};

export type ManagedStateCreateInput = Omit<
  ManagedStateRecord,
  "id" | "scope" | "createdAt" | "updatedAt"
>;

export type WorkbenchDataClient = AgentFrameworkDataClient & {
  createId(prefix: string): Promise<Id>;
  getRun(scope: TenantScope, runId: Id): Promise<RunRecord | undefined>;
  getLatestRunId(scope: TenantScope): Promise<Id | undefined>;
  linkRunToolCall(scope: TenantScope, input: { runId: Id; toolCallId: Id }): Promise<RunRecord>;
  linkRunOutputs(scope: TenantScope, input: RunOutputLinksInput): Promise<RunRecord>;
  listWorkflowIntents(scope: TenantScope): Promise<WorkflowIntentRecord[]>;
  listToolCalls(scope: TenantScope): Promise<ToolCallRecord[]>;
  listArtifacts(scope: TenantScope): Promise<ArtifactMetadataRecord[]>;
  listAuditEvents(scope: TenantScope): Promise<AuditEventRecord[]>;
  listManagedState(scope: TenantScope): Promise<ManagedStateRecord[]>;
  createManagedState(
    scope: TenantScope,
    input: ManagedStateCreateInput,
  ): Promise<ManagedStateRecord>;
};

type StoreDriver = {
  update<T>(mutator: (store: DemoStore) => T | Promise<T>): Promise<T>;
};

type DemoGlobal = typeof globalThis & {
  __assistantMk1MemoryStore?: DemoStore;
  __assistantMk1FileClient?: WorkbenchDataClient;
};

const now = () => new Date().toISOString();

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

const scopeKey = (scope: TenantScope) => `${scope.userId}:${scope.workspaceId}`;

const sameScope = (record: { scope: TenantScope }, scope: TenantScope) =>
  record.scope.userId === scope.userId && record.scope.workspaceId === scope.workspaceId;

const createFixtureRecords = (scope: TenantScope, agentId: Id, createdAt: string) => ({
  user: {
    id: scope.userId,
    displayName: "Fixture User",
    email: `${scope.userId}@example.local`,
    createdAt,
    updatedAt: createdAt,
  } satisfies UserRecord,
  workspace: {
    id: scope.workspaceId,
    name: "Fixture Workspace",
    createdByUserId: scope.userId,
    createdAt,
    updatedAt: createdAt,
  } satisfies WorkspaceRecord,
  membership: {
    id: `${scope.userId}-${scope.workspaceId}-membership`,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    role: "owner",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  } satisfies MembershipRecord,
  agent: {
    id: agentId,
    scope,
    name: "Fixture Agent",
    description: "Local workbench vertical-slice agent.",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  } satisfies AgentRecord,
});

export const createInitialDemoStore = (): DemoStore => {
  const createdAt = now();
  const fixture = createFixtureRecords(DEMO_SCOPE, DEMO_AGENT_ID, createdAt);

  return {
    users: [fixture.user],
    workspaces: [fixture.workspace],
    memberships: [fixture.membership],
    agents: [fixture.agent],
    threads: [],
    workflowIntents: [],
    runs: [],
    toolCalls: [],
    artifacts: [],
    decisions: [],
    auditEvents: [],
    managedState: [],
    ledger: [],
    latestRunIds: {},
    counter: 0,
  };
};

const normalizeStore = (value: unknown): DemoStore => {
  const parsed = value as Partial<DemoStore>;
  const store: DemoStore = {
    users: parsed.users ?? [],
    workspaces: parsed.workspaces ?? [],
    memberships: parsed.memberships ?? [],
    agents: parsed.agents ?? [],
    threads: parsed.threads ?? [],
    workflowIntents: parsed.workflowIntents ?? [],
    runs: parsed.runs ?? [],
    toolCalls: parsed.toolCalls ?? [],
    artifacts: parsed.artifacts ?? [],
    decisions: parsed.decisions ?? [],
    auditEvents: parsed.auditEvents ?? [],
    managedState: parsed.managedState ?? [],
    ledger: parsed.ledger ?? [],
    latestRunIds: parsed.latestRunIds ?? {},
    counter: parsed.counter ?? 0,
  };

  if (parsed.latestRunId) {
    store.latestRunIds[scopeKey(DEMO_SCOPE)] = parsed.latestRunId;
  }

  return store;
};

const ensureFixtureScope = (store: DemoStore, scope: TenantScope, agentId = DEMO_AGENT_ID) => {
  const timestamp = now();
  const fixture = createFixtureRecords(scope, agentId, timestamp);

  if (!store.users.some((record) => record.id === scope.userId)) store.users.push(fixture.user);
  if (!store.workspaces.some((record) => record.id === scope.workspaceId)) {
    store.workspaces.push(fixture.workspace);
  }
  if (
    !store.memberships.some(
      (record) => record.userId === scope.userId && record.workspaceId === scope.workspaceId,
    )
  ) {
    store.memberships.push(fixture.membership);
  }
  if (!store.agents.some((record) => sameScope(record, scope) && record.id === agentId)) {
    store.agents.push(fixture.agent);
  }
};

class MemoryStoreDriver implements StoreDriver {
  private readonly store: DemoStore;
  private queue = Promise.resolve();

  constructor(store = createInitialDemoStore()) {
    this.store = store;
  }

  async update<T>(mutator: (store: DemoStore) => T | Promise<T>) {
    const next = this.queue.then(async () => clone(await mutator(this.store)));
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

class FileStoreDriver implements StoreDriver {
  private queue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async update<T>(mutator: (store: DemoStore) => T | Promise<T>) {
    const next = this.queue.then(async () => {
      const store = await this.readStore();
      const result = await mutator(store);
      await this.writeStore(store);
      return clone(result);
    });
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readStore() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeStore(JSON.parse(raw));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return createInitialDemoStore();
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Workbench store contains invalid JSON: ${this.filePath}`);
      }
      throw error;
    }
  }

  private async writeStore(store: DemoStore) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(store, null, 2)}\n`);
  }
}

const createRecordId = (store: DemoStore, prefix: string) => {
  store.counter += 1;
  return `${prefix}-${store.counter.toString().padStart(4, "0")}`;
};

const createClientFromDriver = (driver: StoreDriver): WorkbenchDataClient => {
  const client: WorkbenchDataClient = {
    createId: async (prefix) => driver.update((store) => createRecordId(store, prefix)),
    getRun: async (scope, runId) =>
      driver.update((store) =>
        store.runs.find((candidate) => sameScope(candidate, scope) && candidate.id === runId),
      ),
    getLatestRunId: async (scope) => driver.update((store) => store.latestRunIds[scopeKey(scope)]),
    linkRunToolCall: async (scope, input) =>
      driver.update((store) => {
        const run = store.runs.find(
          (candidate) => sameScope(candidate, scope) && candidate.id === input.runId,
        );
        if (!run) throw new Error(`Run not found: ${input.runId}`);
        run.toolCallIds = Array.from(new Set([...(run.toolCallIds ?? []), input.toolCallId]));
        run.updatedAt = now();
        return run;
      }),
    linkRunOutputs: async (scope, input) =>
      driver.update((store) => {
        const run = store.runs.find(
          (candidate) => sameScope(candidate, scope) && candidate.id === input.runId,
        );
        if (!run) throw new Error(`Run not found: ${input.runId}`);
        if (input.artifactRef) run.artifactRefs = [input.artifactRef];
        if (input.decisionRecordId) run.decisionRecordIds = [input.decisionRecordId];
        run.updatedAt = now();
        return run;
      }),
    listWorkflowIntents: async (scope) =>
      driver.update((store) => store.workflowIntents.filter((record) => sameScope(record, scope))),
    listToolCalls: async (scope) =>
      driver.update((store) => store.toolCalls.filter((record) => sameScope(record, scope))),
    listArtifacts: async (scope) =>
      driver.update((store) => store.artifacts.filter((record) => sameScope(record, scope))),
    listAuditEvents: async (scope) =>
      driver.update((store) => store.auditEvents.filter((record) => sameScope(record, scope))),
    listManagedState: async (scope) =>
      driver.update((store) => store.managedState.filter((record) => sameScope(record, scope))),
    createManagedState: async (scope, input) =>
      driver.update((store) => {
        ensureFixtureScope(store, scope, input.agentId);
        const timestamp = now();
        const record: ManagedStateRecord = {
          ...input,
          id: createRecordId(store, "managed-state"),
          scope,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        store.managedState.push(record);
        return record;
      }),
    workspaceContext: {
      load: async (scope): Promise<WorkspaceContext> =>
        driver.update((store) => {
          ensureFixtureScope(store, scope);
          const user = store.users.find((record) => record.id === scope.userId);
          const workspace = store.workspaces.find((record) => record.id === scope.workspaceId);
          const membership = store.memberships.find(
            (record) => record.userId === scope.userId && record.workspaceId === scope.workspaceId,
          );

          if (!user || !workspace || !membership) {
            throw new Error("Fixture workspace context was not found");
          }

          return {
            user,
            workspace,
            membership,
            agents: store.agents.filter((record) => sameScope(record, scope)),
            openThreads: store.threads.filter((record) => sameScope(record, scope)),
          };
        }),
    },
    decisions: {
      create: async (scope, input: DecisionRecordCreateInput) =>
        driver.update((store) => {
          ensureFixtureScope(store, scope, input.agentId);
          const timestamp = now();
          const record: DecisionRecordEntity = {
            ...input,
            id: createRecordId(store, "decision"),
            scope,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          store.decisions.push(record);
          return record;
        }),
      list: async (scope, filters) =>
        driver.update((store) => {
          let records = store.decisions.filter((record) => sameScope(record, scope));
          if (filters?.agentId)
            records = records.filter((record) => record.agentId === filters.agentId);
          if (filters?.status)
            records = records.filter((record) => record.status === filters.status);
          if (filters?.relatedDecisionId) {
            records = records.filter((record) =>
              record.relatedDecisionIds?.includes(filters.relatedDecisionId!),
            );
          }
          return records.slice(0, filters?.limit ?? records.length);
        }),
      supersede: async (scope, input) =>
        driver.update((store) => {
          const timestamp = now();
          const replacement: DecisionRecordEntity = {
            ...input.replacement,
            id: createRecordId(store, "decision"),
            scope,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          store.decisions.push(replacement);
          const existing = store.decisions.find(
            (record) => sameScope(record, scope) && record.id === input.decisionId,
          );
          if (existing) {
            existing.status = "superseded";
            existing.updatedAt = timestamp;
            existing.data = {
              ...existing.data,
              supersededBy: replacement.id,
              reason: input.reason,
            };
          }
          return replacement;
        }),
    },
    workflowIntents: {
      create: async <Payload = unknown>(
        scope: TenantScope,
        input: WorkflowIntentCreateInput<Payload>,
      ) =>
        driver.update((store) => {
          ensureFixtureScope(store, scope, input.agentId);
          const timestamp = now();
          const record: WorkflowIntentRecord<Payload> = {
            ...input,
            id: createRecordId(store, "intent"),
            scope,
            status: input.status ?? "queued",
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          store.workflowIntents.push(record as WorkflowIntentRecord);
          return record;
        }),
      updateStatus: async (scope, input: WorkflowIntentUpdateStatusInput) =>
        driver.update((store) => {
          const record = store.workflowIntents.find(
            (candidate) => sameScope(candidate, scope) && candidate.id === input.id,
          );
          if (!record) throw new Error(`Workflow intent not found: ${input.id}`);
          record.status = input.status;
          record.updatedAt = now();
          record.data = { ...record.data, ...input.data };
          return record;
        }),
    },
    runs: {
      create: async (scope, input: RunCreateInput) =>
        driver.update((store) => {
          ensureFixtureScope(store, scope, input.agentId);
          const timestamp = now();
          const record: RunRecord = {
            ...input,
            id: createRecordId(store, "run"),
            scope,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          store.runs.push(record);
          store.latestRunIds[scopeKey(scope)] = record.id;
          return record;
        }),
      updateStatus: async (scope, input: RunUpdateStatusInput) =>
        driver.update((store) => {
          const record = store.runs.find(
            (candidate) => sameScope(candidate, scope) && candidate.id === input.id,
          );
          if (!record) throw new Error(`Run not found: ${input.id}`);
          record.status = input.status;
          record.heartbeatAt = input.heartbeatAt ?? record.heartbeatAt;
          record.lastEventAt = input.lastEventAt ?? record.lastEventAt;
          record.currentInterruptId = input.currentInterruptId ?? record.currentInterruptId;
          record.updatedAt = now();
          record.data = { ...record.data, ...input.data };
          if (input.status === "completed") record.completedAt = record.updatedAt;
          if (input.status === "failed") record.failedAt = record.updatedAt;
          if (input.status === "cancelled") record.cancelledAt = record.updatedAt;
          return record;
        }),
      list: async (scope, filters) =>
        driver.update((store) => {
          let records = store.runs.filter((record) => sameScope(record, scope));
          if (filters?.agentId)
            records = records.filter((record) => record.agentId === filters.agentId);
          if (filters?.threadId)
            records = records.filter((record) => record.threadId === filters.threadId);
          if (filters?.workflowIntentId) {
            records = records.filter(
              (record) => record.workflowIntentId === filters.workflowIntentId,
            );
          }
          if (filters?.parentRunId) {
            records = records.filter(
              (record) => record.relation?.parentRunId === filters.parentRunId,
            );
          }
          if (filters?.status)
            records = records.filter((record) => record.status === filters.status);
          return records.slice(0, filters?.limit ?? records.length);
        }),
    },
    toolCalls: {
      recordStarted: async (scope, input: ToolCallRecordStartedInput) =>
        driver.update((store) => {
          const timestamp = now();
          const record: ToolCallRecord = {
            ...input,
            id: createRecordId(store, "tool-call"),
            scope,
            createdAt: timestamp,
          };
          store.toolCalls.push(record);
          return record;
        }),
      recordFinished: async (scope, input: ToolCallRecordFinishedInput) =>
        driver.update((store) => {
          const record = store.toolCalls.find(
            (candidate) => sameScope(candidate, scope) && candidate.id === input.id,
          );
          if (!record) throw new Error(`Tool call not found: ${input.id}`);
          record.status = input.status;
          record.finishedAt = input.finishedAt;
          record.outputSummary = input.outputSummary ?? record.outputSummary;
          record.error = input.error;
          record.artifactRefs = input.artifactRefs ?? record.artifactRefs;
          record.data = { ...record.data, ...input.data };
          return record;
        }),
    },
    audit: {
      append: async (scope, input: AuditEventAppendInput) =>
        driver.update((store) => {
          const record: AuditEventRecord = {
            ...input,
            id: createRecordId(store, "audit"),
            scope,
            createdAt: now(),
          };
          store.auditEvents.push(record);
          return record;
        }),
    },
    artifacts: {
      createMetadata: async (scope, input: ArtifactMetadataCreateInput) =>
        driver.update((store) => {
          const record: ArtifactMetadataRecord = {
            ...input,
            id: createRecordId(store, "artifact"),
            scope,
            createdAt: now(),
          };
          store.artifacts.push(record);
          return record;
        }),
      createUploadUrl: async (scope, input) => {
        const artifact = await client.artifacts.createMetadata(scope, {
          kind: input.kind,
          title: input.title,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uri: `demo://upload/${await client.createId("object")}`,
          createdBy: { type: "system", name: "Fixture Runtime" },
          data: input.data,
        });
        return {
          artifact,
          uploadUrl: artifact.uri,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
    managedState: {
      get: async (scope, input) =>
        driver.update((store) =>
          store.managedState.find(
            (record) =>
              sameScope(record, scope) &&
              (!input.id || record.id === input.id) &&
              (!input.agentId || record.agentId === input.agentId) &&
              (!input.type || record.type === input.type) &&
              (!input.name || record.name === input.name),
          ),
        ),
      patch: async (scope, input: ManagedStatePatchInput) =>
        driver.update((store) => {
          const record = store.managedState.find(
            (candidate) => sameScope(candidate, scope) && candidate.id === input.id,
          );
          if (!record) throw new Error(`Managed state not found: ${input.id}`);
          record.status = input.status ?? record.status;
          record.summary = input.summary ?? record.summary;
          record.artifactRefs = input.artifactRefs ?? record.artifactRefs;
          record.data = { ...record.data, ...input.data };
          record.updatedAt = now();
          return record;
        }),
    },
    ledger: {
      append: async (scope, input: LedgerEntryAppendInput) =>
        driver.update((store) => {
          ensureFixtureScope(store, scope, input.agentId);
          const record: LedgerEntryRecord = {
            ...input,
            id: createRecordId(store, "ledger"),
            scope,
            createdAt: now(),
          };
          store.ledger.push(record);
          return record;
        }),
      list: async (scope, filters) =>
        driver.update((store) => {
          let records = store.ledger.filter((record) => sameScope(record, scope));
          if (filters?.agentId)
            records = records.filter((record) => record.agentId === filters.agentId);
          if (filters?.workflowIntentId) {
            records = records.filter(
              (record) => record.workflowIntentId === filters.workflowIntentId,
            );
          }
          if (filters?.toolCallId)
            records = records.filter((record) => record.toolCallId === filters.toolCallId);
          if (filters?.status)
            records = records.filter((record) => record.status === filters.status);
          if (filters?.type) records = records.filter((record) => record.type === filters.type);
          return records.slice(0, filters?.limit ?? records.length);
        }),
    },
  };

  return client;
};

export const createMemoryWorkbenchDataClient = () =>
  createClientFromDriver(new MemoryStoreDriver());

export const createFileWorkbenchDataClient = (filePath: string) =>
  createClientFromDriver(new FileStoreDriver(filePath));

const resolveWorkbenchStorePath = () => {
  const configuredPath = process.env.WORKBENCH_STORE_PATH;
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(/* turbopackIgnore: true */ process.cwd(), configuredPath);
  }
  return path.join(/* turbopackIgnore: true */ process.cwd(), DEFAULT_WORKBENCH_STORE_PATH);
};

export const getWorkbenchDataClient = () => {
  const globalStore = globalThis as DemoGlobal;
  if (!globalStore.__assistantMk1FileClient) {
    globalStore.__assistantMk1FileClient = createFileWorkbenchDataClient(
      resolveWorkbenchStorePath(),
    );
  }
  return globalStore.__assistantMk1FileClient;
};

export const demoDataClient = getWorkbenchDataClient();
