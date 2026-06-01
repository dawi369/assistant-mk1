import type { Id, TenantScope } from "@/lib/agent-framework/contracts";
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
  latestRunId?: Id;
  counter: number;
};

type DemoGlobal = typeof globalThis & {
  __assistantMk1DemoStore?: DemoStore;
};

const now = () => new Date().toISOString();

const sameScope = (record: { scope: TenantScope }, scope: TenantScope) =>
  record.scope.userId === scope.userId && record.scope.workspaceId === scope.workspaceId;

export const createDemoId = (prefix: string) => {
  const store = getDemoStore();
  store.counter += 1;
  return `${prefix}-${store.counter.toString().padStart(4, "0")}`;
};

export const getDemoStore = (): DemoStore => {
  const globalStore = globalThis as DemoGlobal;
  if (!globalStore.__assistantMk1DemoStore) {
    const createdAt = now();
    globalStore.__assistantMk1DemoStore = {
      users: [
        {
          id: DEMO_SCOPE.userId,
          displayName: "Fixture User",
          email: "fixture-user@example.local",
          createdAt,
          updatedAt: createdAt,
        },
      ],
      workspaces: [
        {
          id: DEMO_SCOPE.workspaceId,
          name: "Fixture Workspace",
          createdByUserId: DEMO_SCOPE.userId,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      memberships: [
        {
          id: "fixture-membership",
          userId: DEMO_SCOPE.userId,
          workspaceId: DEMO_SCOPE.workspaceId,
          role: "owner",
          status: "active",
          createdAt,
          updatedAt: createdAt,
        },
      ],
      agents: [
        {
          id: DEMO_AGENT_ID,
          scope: DEMO_SCOPE,
          name: "Fixture Agent",
          description: "Local workbench vertical-slice agent.",
          status: "active",
          createdAt,
          updatedAt: createdAt,
        },
      ],
      threads: [],
      workflowIntents: [],
      runs: [],
      toolCalls: [],
      artifacts: [],
      decisions: [],
      auditEvents: [],
      managedState: [],
      ledger: [],
      counter: 0,
    };
  }
  return globalStore.__assistantMk1DemoStore;
};

export const demoDataClient: AgentFrameworkDataClient = {
  workspaceContext: {
    load: async (scope): Promise<WorkspaceContext> => {
      const store = getDemoStore();
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
    },
  },
  decisions: {
    create: async (scope, input: DecisionRecordCreateInput) => {
      const timestamp = now();
      const record: DecisionRecordEntity = {
        ...input,
        id: createDemoId("decision"),
        scope,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      getDemoStore().decisions.push(record);
      return record;
    },
    list: async (scope, filters) => {
      let records = getDemoStore().decisions.filter((record) => sameScope(record, scope));
      if (filters?.agentId)
        records = records.filter((record) => record.agentId === filters.agentId);
      if (filters?.status) records = records.filter((record) => record.status === filters.status);
      if (filters?.relatedDecisionId) {
        records = records.filter((record) =>
          record.relatedDecisionIds?.includes(filters.relatedDecisionId!),
        );
      }
      return records.slice(0, filters?.limit ?? records.length);
    },
    supersede: async (scope, input) => {
      const replacement = await demoDataClient.decisions.create(scope, input.replacement);
      const timestamp = now();
      const existing = getDemoStore().decisions.find(
        (record) => sameScope(record, scope) && record.id === input.decisionId,
      );
      if (existing) {
        existing.status = "superseded";
        existing.updatedAt = timestamp;
        existing.data = { ...existing.data, supersededBy: replacement.id, reason: input.reason };
      }
      return replacement;
    },
  },
  workflowIntents: {
    create: async <Payload = unknown>(
      scope: TenantScope,
      input: WorkflowIntentCreateInput<Payload>,
    ) => {
      const timestamp = now();
      const record: WorkflowIntentRecord<Payload> = {
        ...input,
        id: createDemoId("intent"),
        scope,
        status: input.status ?? "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      getDemoStore().workflowIntents.push(record as WorkflowIntentRecord);
      return record;
    },
    updateStatus: async (scope, input: WorkflowIntentUpdateStatusInput) => {
      const record = getDemoStore().workflowIntents.find(
        (candidate) => sameScope(candidate, scope) && candidate.id === input.id,
      );
      if (!record) throw new Error(`Workflow intent not found: ${input.id}`);
      record.status = input.status;
      record.updatedAt = now();
      record.data = { ...record.data, ...input.data };
      return record;
    },
  },
  runs: {
    create: async (scope, input: RunCreateInput) => {
      const timestamp = now();
      const record: RunRecord = {
        ...input,
        id: createDemoId("run"),
        scope,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const store = getDemoStore();
      store.runs.push(record);
      store.latestRunId = record.id;
      return record;
    },
    updateStatus: async (scope, input: RunUpdateStatusInput) => {
      const record = getDemoStore().runs.find(
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
    },
    list: async (scope, filters) => {
      let records = getDemoStore().runs.filter((record) => sameScope(record, scope));
      if (filters?.agentId)
        records = records.filter((record) => record.agentId === filters.agentId);
      if (filters?.threadId)
        records = records.filter((record) => record.threadId === filters.threadId);
      if (filters?.workflowIntentId) {
        records = records.filter((record) => record.workflowIntentId === filters.workflowIntentId);
      }
      if (filters?.parentRunId) {
        records = records.filter((record) => record.relation?.parentRunId === filters.parentRunId);
      }
      if (filters?.status) records = records.filter((record) => record.status === filters.status);
      return records.slice(0, filters?.limit ?? records.length);
    },
  },
  toolCalls: {
    recordStarted: async (scope, input: ToolCallRecordStartedInput) => {
      const timestamp = now();
      const record: ToolCallRecord = {
        ...input,
        id: createDemoId("tool-call"),
        scope,
        createdAt: timestamp,
      };
      getDemoStore().toolCalls.push(record);
      return record;
    },
    recordFinished: async (scope, input: ToolCallRecordFinishedInput) => {
      const record = getDemoStore().toolCalls.find(
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
    },
  },
  audit: {
    append: async (scope, input: AuditEventAppendInput) => {
      const record: AuditEventRecord = {
        ...input,
        id: createDemoId("audit"),
        scope,
        createdAt: now(),
      };
      getDemoStore().auditEvents.push(record);
      return record;
    },
  },
  artifacts: {
    createMetadata: async (scope, input: ArtifactMetadataCreateInput) => {
      const record: ArtifactMetadataRecord = {
        ...input,
        id: createDemoId("artifact"),
        scope,
        createdAt: now(),
      };
      getDemoStore().artifacts.push(record);
      return record;
    },
    createUploadUrl: async (scope, input) => {
      const artifact = await demoDataClient.artifacts.createMetadata(scope, {
        kind: input.kind,
        title: input.title,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uri: `demo://upload/${createDemoId("object")}`,
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
    get: async (scope, input) => {
      return getDemoStore().managedState.find(
        (record) =>
          sameScope(record, scope) &&
          (!input.id || record.id === input.id) &&
          (!input.agentId || record.agentId === input.agentId) &&
          (!input.type || record.type === input.type) &&
          (!input.name || record.name === input.name),
      );
    },
    patch: async (scope, input: ManagedStatePatchInput) => {
      const record = getDemoStore().managedState.find(
        (candidate) => sameScope(candidate, scope) && candidate.id === input.id,
      );
      if (!record) throw new Error(`Managed state not found: ${input.id}`);
      record.status = input.status ?? record.status;
      record.summary = input.summary ?? record.summary;
      record.artifactRefs = input.artifactRefs ?? record.artifactRefs;
      record.data = { ...record.data, ...input.data };
      record.updatedAt = now();
      return record;
    },
  },
  ledger: {
    append: async (scope, input: LedgerEntryAppendInput) => {
      const record: LedgerEntryRecord = {
        ...input,
        id: createDemoId("ledger"),
        scope,
        createdAt: now(),
      };
      getDemoStore().ledger.push(record);
      return record;
    },
    list: async (scope, filters) => {
      let records = getDemoStore().ledger.filter((record) => sameScope(record, scope));
      if (filters?.agentId)
        records = records.filter((record) => record.agentId === filters.agentId);
      if (filters?.workflowIntentId) {
        records = records.filter((record) => record.workflowIntentId === filters.workflowIntentId);
      }
      if (filters?.toolCallId)
        records = records.filter((record) => record.toolCallId === filters.toolCallId);
      if (filters?.status) records = records.filter((record) => record.status === filters.status);
      if (filters?.type) records = records.filter((record) => record.type === filters.type);
      return records.slice(0, filters?.limit ?? records.length);
    },
  },
};
