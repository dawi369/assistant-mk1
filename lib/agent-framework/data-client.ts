/**
 * Repository-style data-client contracts.
 *
 * These interfaces describe how workflow code talks to durable app state.
 * They intentionally do not describe storage, network transport, validation,
 * migrations, D1 tables, R2 objects, or Cloudflare/Fly implementation details.
 */

import type { Id, TenantScope } from "./contracts";
import type {
  AgentRecord,
  ArtifactMetadataRecord,
  AuditEventRecord,
  DecisionRecordEntity,
  LedgerEntryRecord,
  ManagedStateRecord,
  MembershipRecord,
  RecordData,
  RecordStatus,
  RunRecord,
  ThreadRecord,
  ToolCallRecord,
  UserRecord,
  WorkflowIntentRecord,
  WorkspaceRecord,
} from "./db-contracts";

export type DataClientScope = TenantScope;

export type WorkspaceContext = {
  user: UserRecord;
  workspace: WorkspaceRecord;
  membership: MembershipRecord;
  agents?: AgentRecord[];
  openThreads?: ThreadRecord[];
  data?: RecordData;
};

export type WorkspaceContextLoadInput = {
  agentId?: Id;
  threadId?: Id;
};

export type DecisionRecordCreateInput = Omit<
  DecisionRecordEntity,
  "id" | "scope" | "createdAt" | "updatedAt"
>;

export type DecisionRecordListFilters = {
  agentId?: Id;
  status?: RecordStatus;
  relatedDecisionId?: Id;
  limit?: number;
};

export type DecisionRecordSupersedeInput = {
  decisionId: Id;
  replacement: DecisionRecordCreateInput;
  reason?: string;
};

export type WorkflowIntentCreateInput<Payload = unknown> = Omit<
  WorkflowIntentRecord<Payload>,
  "id" | "scope" | "createdAt" | "updatedAt" | "status"
> & {
  status?: RecordStatus;
};

export type WorkflowIntentUpdateStatusInput = {
  id: Id;
  status: RecordStatus;
  data?: RecordData;
};

export type RunCreateInput = Omit<RunRecord, "id" | "scope" | "createdAt" | "updatedAt">;

export type RunUpdateStatusInput = {
  id: Id;
  status: RunRecord["status"];
  heartbeatAt?: string;
  lastEventAt?: string;
  currentInterruptId?: Id;
  data?: RecordData;
};

export type RunListFilters = {
  agentId?: Id;
  threadId?: Id;
  workflowIntentId?: Id;
  parentRunId?: Id;
  status?: RunRecord["status"];
  limit?: number;
};

export type ToolCallRecordStartedInput = Omit<
  ToolCallRecord,
  "id" | "scope" | "createdAt" | "finishedAt"
>;

export type ToolCallRecordFinishedInput = {
  id: Id;
  status: RecordStatus;
  finishedAt: string;
  outputSummary?: string;
  error?: ToolCallRecord["error"];
  artifactRefs?: ToolCallRecord["artifactRefs"];
  data?: RecordData;
};

export type AuditEventAppendInput = Omit<AuditEventRecord, "id" | "scope" | "createdAt">;

export type ArtifactMetadataCreateInput = Omit<
  ArtifactMetadataRecord,
  "id" | "scope" | "createdAt"
>;

export type ArtifactUploadUrlInput = {
  kind: ArtifactMetadataRecord["kind"];
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  data?: RecordData;
};

export type ArtifactUploadUrlResult = {
  artifact: ArtifactMetadataRecord;
  uploadUrl: string;
  expiresAt: string;
};

export type ManagedStateGetInput = {
  id?: Id;
  agentId?: Id;
  type?: string;
  name?: string;
};

export type ManagedStatePatchInput = {
  id: Id;
  status?: RecordStatus;
  summary?: string;
  artifactRefs?: ManagedStateRecord["artifactRefs"];
  data?: RecordData;
};

export type LedgerEntryAppendInput = Omit<LedgerEntryRecord, "id" | "scope" | "createdAt">;

export type LedgerEntryListFilters = {
  agentId?: Id;
  workflowIntentId?: Id;
  toolCallId?: Id;
  status?: RecordStatus;
  type?: string;
  limit?: number;
};

export type WorkspaceContextRepository = {
  load(scope: DataClientScope, input?: WorkspaceContextLoadInput): Promise<WorkspaceContext>;
};

export type DecisionRecordRepository = {
  create(scope: DataClientScope, input: DecisionRecordCreateInput): Promise<DecisionRecordEntity>;
  list(
    scope: DataClientScope,
    filters?: DecisionRecordListFilters,
  ): Promise<DecisionRecordEntity[]>;
  supersede(
    scope: DataClientScope,
    input: DecisionRecordSupersedeInput,
  ): Promise<DecisionRecordEntity>;
};

export type WorkflowIntentRepository = {
  create<Payload = unknown>(
    scope: DataClientScope,
    input: WorkflowIntentCreateInput<Payload>,
  ): Promise<WorkflowIntentRecord<Payload>>;
  updateStatus(
    scope: DataClientScope,
    input: WorkflowIntentUpdateStatusInput,
  ): Promise<WorkflowIntentRecord>;
};

export type RunRepository = {
  create(scope: DataClientScope, input: RunCreateInput): Promise<RunRecord>;
  updateStatus(scope: DataClientScope, input: RunUpdateStatusInput): Promise<RunRecord>;
  list(scope: DataClientScope, filters?: RunListFilters): Promise<RunRecord[]>;
};

export type ToolCallRepository = {
  recordStarted(scope: DataClientScope, input: ToolCallRecordStartedInput): Promise<ToolCallRecord>;
  recordFinished(
    scope: DataClientScope,
    input: ToolCallRecordFinishedInput,
  ): Promise<ToolCallRecord>;
};

export type AuditEventRepository = {
  append(scope: DataClientScope, input: AuditEventAppendInput): Promise<AuditEventRecord>;
};

export type ArtifactRepository = {
  createMetadata(
    scope: DataClientScope,
    input: ArtifactMetadataCreateInput,
  ): Promise<ArtifactMetadataRecord>;
  createUploadUrl(
    scope: DataClientScope,
    input: ArtifactUploadUrlInput,
  ): Promise<ArtifactUploadUrlResult>;
};

export type ManagedStateRepository = {
  get(scope: DataClientScope, input: ManagedStateGetInput): Promise<ManagedStateRecord | undefined>;
  patch(scope: DataClientScope, input: ManagedStatePatchInput): Promise<ManagedStateRecord>;
};

export type LedgerRepository = {
  append(scope: DataClientScope, input: LedgerEntryAppendInput): Promise<LedgerEntryRecord>;
  list(scope: DataClientScope, filters?: LedgerEntryListFilters): Promise<LedgerEntryRecord[]>;
};

export type AgentFrameworkDataClient = {
  workspaceContext: WorkspaceContextRepository;
  decisions: DecisionRecordRepository;
  workflowIntents: WorkflowIntentRepository;
  runs: RunRepository;
  toolCalls: ToolCallRepository;
  audit: AuditEventRepository;
  artifacts: ArtifactRepository;
  managedState: ManagedStateRepository;
  ledger: LedgerRepository;
};
