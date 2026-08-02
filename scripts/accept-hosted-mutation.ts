import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSmokeContext, defaultWorkspaceId, type TenantIdentity } from "./smoke-utils";
import { isEnvironmentTarget } from "./workbench-environment";

const main = async () => {
  const enabled = process.env.WORKBENCH_HOSTED_MUTATION_MODE === "true";
  const target = process.env.WORKBENCH_ENVIRONMENT?.trim() ?? "";
  const commit = process.env.GITHUB_SHA?.trim() ?? "";
  const organizationId = process.env.HOSTED_MUTATION_ORGANIZATION_ID?.trim() ?? "";
  const connectionSecret = process.env.HOSTED_MUTATION_CONNECTION_SECRET?.trim() ?? "";
  if (!enabled) throw new Error("WORKBENCH_HOSTED_MUTATION_MODE=true is required");
  if (!isEnvironmentTarget(target) || target === "local") {
    throw new Error("WORKBENCH_ENVIRONMENT must be acceptance|production");
  }
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("GITHUB_SHA must be a full commit");
  if (!organizationId || !connectionSecret)
    throw new Error("Hosted mutation organization and connection secret are required");

  const suffix = `${commit.slice(0, 8)}-${Date.now().toString(36)}`;
  const accountId = `workos-org:${organizationId}`;
  const owner: TenantIdentity = {
    userId: `mutation-acceptance-${suffix}`,
    accountId,
    accountSource: "workos-organization",
    workspaceId: defaultWorkspaceId(accountId),
    email: `mutation-acceptance-${suffix}@example.com`,
    name: "Mutation Acceptance",
    role: "owner",
    roles: ["owner"],
    permissions: ["workbench:read"],
    authMode: "workos",
    workspaceSource: "workos-organization",
  };
  const { assertStatus, fetchRaw, readJson } = createSmokeContext();

  await readJson("/admin/workspace-summary", owner);
  const instantiated = await readJson<{ agent?: { id?: string } }>(
    "/agent-packs/complex-operator/instantiate",
    owner,
    { method: "POST" },
  );
  if (!instantiated.agent?.id) throw new Error("Complex Operator activation failed");
  owner.agentId = instantiated.agent.id;
  await readJson(`/agents/${encodeURIComponent(owner.agentId)}/activate`, owner, {
    method: "POST",
  });
  await readJson("/workbench/retention-policy", owner, {
    method: "PATCH",
    body: JSON.stringify({
      artifactRetentionDays: 90,
      operationalEventRetentionDays: 30,
      runtimeTraceRetentionDays: 14,
      chatMessageRetentionDays: 90,
      runPayloadRetentionDays: 90,
      auditActionRetentionDays: 365,
      confirm: true,
    }),
  });
  await readJson("/workbench/connections/operator.external-account/credentials", owner, {
    method: "POST",
    body: JSON.stringify({ secret: connectionSecret }),
  });
  await readJson("/tools/policy", owner, {
    method: "POST",
    body: JSON.stringify({
      toolName: "operator.action.execute",
      mutationEnabled: true,
    }),
  });
  const createProposal = async (subject: string) => {
    const workflow = await readJson<{ run?: { id?: string } }>(
      "/workbench/workflows/complex-operator.observe",
      owner,
      {
        method: "POST",
        body: JSON.stringify({ executionMode: "dry_run", input: { subject } }),
      },
    );
    const proposals = await readJson<{
      proposals?: Array<{ id: string; status: string; summary: string }>;
    }>("/workbench/actions", owner);
    const proposal = proposals.proposals?.find(
      (candidate) => candidate.status === "proposed" && candidate.summary.includes(subject),
    );
    if (!proposal) throw new Error(`Mutation proposal was not persisted for ${subject}`);
    return { workflow, proposal };
  };

  const { workflow, proposal } = await createProposal(suffix);
  const requested = await readJson<{ approvalRequest?: { id?: string } }>(
    `/workbench/actions/${encodeURIComponent(proposal.id)}/execute`,
    owner,
    { method: "POST" },
  );
  if (!requested.approvalRequest?.id) throw new Error("Mutation approval was not requested");
  const approved = await readJson<{ result?: { status?: string; externalReference?: string } }>(
    `/tools/approvals/${encodeURIComponent(requested.approvalRequest.id)}/approve`,
    owner,
    { method: "POST" },
  );
  if (approved.result?.status !== "executed" || !approved.result.externalReference) {
    throw new Error("Synthetic mutation did not reach an executed terminal state");
  }

  await assertStatus(`/workbench/actions/${encodeURIComponent(proposal.id)}/execute`, owner, 409, {
    method: "POST",
  });

  await readJson("/workbench/kill-switches", owner, {
    method: "PUT",
    body: JSON.stringify({
      scopeKind: "pack",
      scopeId: "complex-operator",
      enabled: true,
      reason: "Same-commit hosted mutation acceptance drill.",
    }),
  });
  const blocked = await createProposal(`${suffix}-kill-switch`);
  await assertStatus(
    `/workbench/actions/${encodeURIComponent(blocked.proposal.id)}/execute`,
    owner,
    403,
    {
      method: "POST",
    },
  );
  await readJson("/workbench/kill-switches", owner, {
    method: "PUT",
    body: JSON.stringify({
      scopeKind: "pack",
      scopeId: "complex-operator",
      enabled: false,
      reason: "Hosted mutation acceptance drill completed.",
    }),
  });

  const timeout = await createProposal("timeout");
  const timeoutRequest = await readJson<{ approvalRequest?: { id?: string } }>(
    `/workbench/actions/${encodeURIComponent(timeout.proposal.id)}/execute`,
    owner,
    { method: "POST" },
  );
  if (!timeoutRequest.approvalRequest?.id)
    throw new Error("Timeout proposal approval was not requested");
  const timeoutApproval = await fetchRaw(
    `/tools/approvals/${encodeURIComponent(timeoutRequest.approvalRequest.id)}/approve`,
    owner,
    { method: "POST" },
  );
  if (timeoutApproval.status !== 502) {
    throw new Error(`Timeout action expected 502, got ${timeoutApproval.status}`);
  }
  const timeoutResult = (await timeoutApproval.json()) as { result?: { status?: string } };
  if (timeoutResult.result?.status !== "outcome_unknown") {
    throw new Error("Timed-out mutation was not fenced as outcome_unknown");
  }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const reconciliation = await readJson<{ result?: { status?: string } }>(
    `/workbench/actions/${encodeURIComponent(timeout.proposal.id)}/reconcile`,
    owner,
    { method: "POST" },
  );
  if (reconciliation.result?.status !== "reconciled") {
    throw new Error("Ambiguous mutation outcome was not reconciled");
  }
  await readJson("/workbench/connections/operator.external-account", owner, { method: "DELETE" });

  const report = {
    schemaVersion: 1,
    target,
    commit,
    generatedAt: new Date().toISOString(),
    ok: true,
    workspaceId: owner.workspaceId,
    runId: workflow.run?.id,
    proposalId: proposal.id,
    approvalRequestId: requested.approvalRequest.id,
    externalReference: approved.result.externalReference,
    duplicateDispatchStatus: 409,
    killSwitchProposalId: blocked.proposal.id,
    killSwitchStatus: 403,
    outcomeUnknownProposalId: timeout.proposal.id,
    reconciled: true,
    connectionRevoked: true,
  };
  const directory = resolve(process.cwd(), "output/release", commit);
  mkdirSync(directory, { recursive: true });
  const outputPath = resolve(directory, "mutation-acceptance.json");
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...report, outputPath }, null, 2));
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
