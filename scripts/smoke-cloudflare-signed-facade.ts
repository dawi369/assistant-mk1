import { facadeSignatureHeader, signFacadeRequest } from "../lib/workbench/control-plane-signing";
import {
  type TenantIdentity,
  createSmokeContext,
  defaultWorkspaceId,
  runSmoke,
} from "./smoke-utils";

type WorkspaceContextResponse = {
  ok?: boolean;
  context?: {
    identity?: {
      userId?: string;
      workspaceId?: string;
    };
  };
  error?: string;
};

const signingSecret = process.env.CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET?.trim();
if (!signingSecret) {
  throw new Error("CLOUDFLARE_CONTROL_PLANE_FACADE_SIGNING_SECRET is required for signed smoke");
}

const { baseUrl, suffix, headersFor, readJson } = createSmokeContext();

const accountId = `workos-org:signed-facade-org-${suffix}`;
const identity: TenantIdentity = {
  userId: `signed-facade-user-${suffix}`,
  accountId,
  accountSource: "workos-organization",
  workspaceId: defaultWorkspaceId(accountId),
  email: `signed-facade-${suffix}@example.com`,
  name: "Signed Facade Smoke User",
  role: "owner",
  roles: ["owner"],
  permissions: ["workbench:read"],
  authMode: "workos",
  workspaceSource: "workos-organization",
};

const expectAuthError = async (response: Response, code: string) => {
  if (response.status !== 401) {
    throw new Error(`expected 401 ${code}, got ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { details?: { code?: string } };
  if (body.details?.code !== code) {
    throw new Error(`expected ${code}, got ${JSON.stringify(body)}`);
  }
};

const signedFetch = async (input: {
  path: string;
  identity: TenantIdentity;
  method?: string;
  body?: string;
  timestamp?: string;
  nonce?: string;
  tamper?: (headers: Record<string, string>) => void;
}) => {
  const method = input.method ?? "GET";
  const headers = headersFor(input.identity);
  Object.assign(
    headers,
    await signFacadeRequest({
      secret: signingSecret,
      method,
      pathWithQuery: input.path,
      body: input.body ?? "",
      headers,
      timestamp: input.timestamp,
      nonce: input.nonce,
    }),
  );
  input.tamper?.(headers);
  return fetch(`${baseUrl}${input.path}`, {
    method,
    headers,
    body: input.body,
  });
};

runSmoke("Cloudflare signed facade smoke", async () => {
  console.log(`Smoking Cloudflare signed facade at ${baseUrl}`);

  const valid = await readJson<WorkspaceContextResponse>("/workspace-context", identity);
  if (!valid.ok || valid.context?.identity?.userId !== identity.userId) {
    throw new Error(`signed workspace context failed: ${JSON.stringify(valid)}`);
  }

  const unsigned = await fetch(`${baseUrl}/workspace-context`, {
    headers: headersFor(identity),
  });
  await expectAuthError(unsigned, "signature_required");

  const stale = await signedFetch({
    path: "/workspace-context",
    identity,
    timestamp: String(Date.now() - 10 * 60 * 1000),
    nonce: `stale-${suffix}`,
  });
  await expectAuthError(stale, "signature_stale");

  const replayPath = "/workspace-context";
  const replayTimestamp = String(Date.now());
  const replayNonce = `replay-${suffix}`;
  const replayHeaders = headersFor(identity);
  Object.assign(
    replayHeaders,
    await signFacadeRequest({
      secret: signingSecret,
      method: "GET",
      pathWithQuery: replayPath,
      headers: replayHeaders,
      timestamp: replayTimestamp,
      nonce: replayNonce,
    }),
  );
  const firstReplay = await fetch(`${baseUrl}${replayPath}`, { headers: replayHeaders });
  if (!firstReplay.ok) {
    throw new Error(`first replay request should succeed: ${firstReplay.status}`);
  }
  const secondReplay = await fetch(`${baseUrl}${replayPath}`, { headers: replayHeaders });
  await expectAuthError(secondReplay, "signature_replay");

  const tampered = await signedFetch({
    path: "/workspace-context",
    identity,
    nonce: `tamper-${suffix}`,
    tamper: (headers) => {
      headers["x-assistant-mk1-user-id"] = `tampered-${identity.userId}`;
      delete headers[facadeSignatureHeader];
    },
  });
  await expectAuthError(tampered, "signature_required");

  const invalid = await signedFetch({
    path: "/workspace-context",
    identity,
    nonce: `invalid-${suffix}`,
    tamper: (headers) => {
      headers["x-assistant-mk1-user-id"] = `tampered-${identity.userId}`;
    },
  });
  await expectAuthError(invalid, "signature_invalid");

  console.log(
    JSON.stringify(
      {
        userId: identity.userId,
        replayTimestamp,
      },
      null,
      2,
    ),
  );
});

export {};
