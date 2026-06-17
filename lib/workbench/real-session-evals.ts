export type RealSessionEvalSurface =
  | "cloudflare_worker_http"
  | "cloudflare_agent_session"
  | "vercel_same_origin"
  | "fly_runner_http";

export type RealSessionEvalAssertion =
  | "messages"
  | "runs"
  | "threads"
  | "tool_calls"
  | "approvals"
  | "hitl"
  | "artifacts"
  | "events"
  | "traces"
  | "tenant_isolation"
  | "runner_sandbox"
  | "schedule_dispatch";

export type RealSessionEvalSuite = {
  id: string;
  command: string;
  surface: RealSessionEvalSurface;
  requiredAssertions: RealSessionEvalAssertion[];
  description: string;
};

export type SupportingEvalContractCheck = {
  id: string;
  command: string;
  requiredAssertions: RealSessionEvalAssertion[];
  description: string;
};

export const realSessionEvalSuites = [
  {
    id: "chat-session-lifecycle",
    command: "pnpm smoke:cloudflare-chat-session-lifecycle",
    surface: "cloudflare_agent_session",
    requiredAssertions: ["threads", "runs", "messages", "events"],
    description: "Exercises create, switch, rename, archive, restore, delete, and running guards.",
  },
  {
    id: "tool-admin-hitl",
    command: "pnpm smoke:cloudflare-tool-admin",
    surface: "cloudflare_worker_http",
    requiredAssertions: ["runs", "tool_calls", "approvals", "hitl", "artifacts", "events"],
    description:
      "Exercises url.inspect policy, approvals, child runs, artifacts, and Admin events.",
  },
  {
    id: "runtime-traces",
    command: "pnpm smoke:cloudflare-runtime-traces",
    surface: "cloudflare_worker_http",
    requiredAssertions: ["runs", "tool_calls", "traces", "runner_sandbox"],
    description: "Exercises runtime trace persistence and runner dispatch metadata.",
  },
  {
    id: "event-stream",
    command: "pnpm smoke:cloudflare-event-stream",
    surface: "cloudflare_worker_http",
    requiredAssertions: ["events", "runs", "tenant_isolation"],
    description: "Exercises replay/live event cursor behavior through Worker HTTP.",
  },
  {
    id: "fly-tool-runner",
    command: "pnpm smoke:fly-tool-runner",
    surface: "fly_runner_http",
    requiredAssertions: ["tool_calls", "runner_sandbox"],
    description: "Exercises the signed runner HTTP boundary and sandbox egress enforcement.",
  },
] as const satisfies RealSessionEvalSuite[];

export const supportingEvalContractChecks = [
  {
    id: "schedule-dispatch-contract",
    command: "pnpm test:unit -- lib/workbench/schedule-dispatch.test.ts",
    requiredAssertions: ["schedule_dispatch", "runs"],
    description:
      "Guards the external-signal schedule dispatch contract until a live LangGraph smoke exists.",
  },
] as const satisfies SupportingEvalContractCheck[];

export const requiredRealSessionAssertions = [
  "messages",
  "runs",
  "threads",
  "tool_calls",
  "approvals",
  "hitl",
  "events",
  "traces",
] as const satisfies RealSessionEvalAssertion[];

export const summarizeRealSessionEvalPosture = () => {
  const coveredAssertions = new Set<RealSessionEvalAssertion>();
  const surfaces = new Set<RealSessionEvalSurface>();

  for (const suite of realSessionEvalSuites) {
    surfaces.add(suite.surface);
    for (const assertion of suite.requiredAssertions) coveredAssertions.add(assertion);
  }

  const missingAssertions = requiredRealSessionAssertions.filter(
    (assertion) => !coveredAssertions.has(assertion),
  );

  return {
    suites: realSessionEvalSuites,
    supportingContractChecks: supportingEvalContractChecks,
    surfaces: Array.from(surfaces).sort(),
    coveredAssertions: Array.from(coveredAssertions).sort(),
    missingAssertions,
    ok: missingAssertions.length === 0,
  };
};
