import { getExternalSignalIdentityHeaders } from "../lib/workbench/external-signal-identity";
import { createSmokeContext, runSmoke } from "./smoke-utils";

type ExternalSignalResponse = {
  threadId?: string;
  run?: unknown;
  cron?: unknown;
  dispatch?: unknown;
  controlPlane?: {
    runId?: string;
    workflowIntentId?: string;
    intentId?: string;
  };
  error?: string;
};

type EventsResponse = {
  events?: Array<{
    type?: string;
    targetId?: string;
    data?: {
      runId?: string;
      workflowIntentId?: string;
      action?: string;
    };
  }>;
};

const vercelBaseUrl = (process.env.EXTERNAL_SIGNAL_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const externalSignalToken = process.env.EXTERNAL_SIGNAL_TOKEN?.trim();
if (!externalSignalToken) {
  throw new Error("EXTERNAL_SIGNAL_TOKEN is required for external signal smoke");
}

const context = createSmokeContext();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const requiredIdentity = getExternalSignalIdentityHeaders();
const owner = {
  userId: requiredIdentity["x-assistant-mk1-user-id"],
  accountId: requiredIdentity["x-assistant-mk1-account-id"],
  accountSource: requiredIdentity["x-assistant-mk1-account-source"],
  email: requiredIdentity["x-assistant-mk1-user-email"],
  name: requiredIdentity["x-assistant-mk1-user-name"],
  role: requiredIdentity["x-assistant-mk1-membership-role"],
};

runSmoke("External signal facade smoke", async () => {
  console.log(`Smoking external signals at ${vercelBaseUrl}`);

  const response = await fetch(`${vercelBaseUrl}/api/external-signals`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${externalSignalToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "start",
      input: { message: `external signal smoke ${suffix}` },
      metadata: { smoke: "external-signals", suffix },
    }),
  });
  const body = (await response.json()) as ExternalSignalResponse;
  if (!response.ok) {
    throw new Error(`external signal failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  if (!body.threadId || !body.run || !body.controlPlane?.runId || !body.controlPlane.intentId) {
    throw new Error(`external signal response missing run envelope: ${JSON.stringify(body)}`);
  }
  const controlPlane = body.controlPlane;

  const events = await context.readJson<EventsResponse>("/events?limit=25", owner);
  const accepted = events.events?.find(
    (event) =>
      event.type === "external_signal.accepted" &&
      event.data?.runId === controlPlane.runId &&
      event.data?.workflowIntentId === controlPlane.workflowIntentId,
  );
  if (!accepted) {
    throw new Error(`external signal control-plane event not found: ${JSON.stringify(events)}`);
  }

  console.log(
    JSON.stringify(
      {
        threadId: body.threadId,
        controlPlane,
      },
      null,
      2,
    ),
  );
});
