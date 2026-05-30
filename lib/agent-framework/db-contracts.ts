/**
 * Early WIP durable entity contracts.
 *
 * These are serializable shapes for framework-owned records that may later be
 * stored in D1, Durable Object SQLite, another relational store, or exposed
 * through mediated Cloudflare APIs. They are not final database schemas, SQL
 * migrations, wire protocols, validation rules, or stable platform APIs.
 *
 * Keep this layer boring: tenant-scoped where needed, JSON-serializable, and
 * flexible enough for project-specific bots to extend through `data`.
 */

import type {
  ArtifactRef,
  ExecutionPolicy,
  Id,
  ProvenanceRef,
  TenantScope,
  WorkflowStage,
} from "./contracts";

export type RecordData = Record<string, unknown>;

export type RecordStatus = string;

export type BaseRecord = {
  id: Id;
  createdAt: string;
  updatedAt?: string;
  data?: RecordData;
};

export type ScopedRecord = BaseRecord & {
  scope: TenantScope;
};

export type ActorRef = {
  type: string;
  id?: Id;
  name?: string;
};

export type EntityRef = {
  type: string;
  id: Id;
  title?: string;
  uri?: string;
};

export type UserRecord = BaseRecord & {
  displayName: string;
  email: string;
  updatedAt: string;
};

export type WorkspaceRecord = BaseRecord & {
  name: string;
  createdByUserId: Id;
  updatedAt: string;
};

export type MembershipRecord = BaseRecord & {
  userId: Id;
  workspaceId: Id;
  role: string;
  status: RecordStatus;
  updatedAt: string;
};

export type AgentRecord = ScopedRecord & {
  name: string;
  description?: string;
  status: RecordStatus;
  updatedAt: string;
};

export type ThreadRecord = ScopedRecord & {
  agentId: Id;
  title: string;
  status: RecordStatus;
  lastActivityAt?: string;
  updatedAt: string;
};

export type WorkflowIntentRecord<Payload = unknown> = ScopedRecord & {
  agentId: Id;
  threadId?: Id;
  stage: WorkflowStage;
  type: string;
  execution: ExecutionPolicy;
  status: RecordStatus;
  payload: Payload;
  relatedDecisionIds?: Id[];
  updatedAt: string;
};

export type DecisionRecordEntity = ScopedRecord & {
  agentId: Id;
  title: string;
  summary: string;
  thesis: string;
  status: RecordStatus;
  provenanceRefs?: ProvenanceRef[];
  artifactRefs?: ArtifactRef[];
  relatedDecisionIds?: Id[];
  updatedAt: string;
};

export type ToolMetadataRecord = BaseRecord & {
  name: string;
  description: string;
  kind: string;
  version: string;
  status: RecordStatus;
  updatedAt: string;
};

export type ToolPermissionRecord = ScopedRecord & {
  toolId: Id;
  agentId?: Id;
  execution: ExecutionPolicy;
  status: RecordStatus;
  updatedAt: string;
};

export type ToolCallError = {
  code: string;
  message: string;
  retryable?: boolean;
};

export type ToolCallRecord = ScopedRecord & {
  toolId: Id;
  workflowIntentId?: Id;
  agentId?: Id;
  threadId?: Id;
  execution: ExecutionPolicy;
  status: RecordStatus;
  inputSummary?: string;
  outputSummary?: string;
  error?: ToolCallError;
  artifactRefs?: ArtifactRef[];
  startedAt: string;
  finishedAt?: string;
};

export type AuditEventRecord = ScopedRecord & {
  actor: ActorRef;
  action: string;
  target?: EntityRef;
  summary: string;
};

export type ArtifactMetadataRecord = ScopedRecord & {
  kind: ArtifactRef["kind"];
  uri: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdBy: ActorRef;
};

export type TriggerRecord = ScopedRecord & {
  agentId: Id;
  type: string;
  status: RecordStatus;
  targetWorkflowType: string;
  execution: ExecutionPolicy;
  lastTriggeredAt?: string;
  nextTriggerAt?: string;
  updatedAt: string;
};

export type ManagedStateRecord = ScopedRecord & {
  agentId: Id;
  type: string;
  name: string;
  status: RecordStatus;
  summary?: string;
  artifactRefs?: ArtifactRef[];
  updatedAt: string;
};

export type LedgerEntryRecord = ScopedRecord & {
  agentId: Id;
  workflowIntentId?: Id;
  toolCallId?: Id;
  type: string;
  status: RecordStatus;
  summary: string;
  decisionRecordIds?: Id[];
  artifactRefs?: ArtifactRef[];
};
