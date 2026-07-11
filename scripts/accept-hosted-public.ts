const requiredOrigin = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use https`);
  return url.origin;
};

const forbiddenKeys = /user|workspace|tenant|token|secret|password|apiKey|credential/i;

const readHealth = async (origin: string, path: string, expectedService: string) => {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || body?.ok !== true || body.service !== expectedService) {
    throw new Error(`${expectedService} ${path} failed with HTTP ${response.status}`);
  }
  const leakedKey = Object.keys(body).find((key) => forbiddenKeys.test(key));
  if (leakedKey) throw new Error(`${expectedService} ${path} exposed forbidden key ${leakedKey}`);
  return { path, status: response.status, service: body.service };
};

const main = async () => {
  const vercel = requiredOrigin("HOSTED_VERCEL_ORIGIN");
  const cloudflare = requiredOrigin("HOSTED_CLOUDFLARE_ORIGIN");
  const fly = requiredOrigin("HOSTED_FLY_ORIGIN");
  const checks = [
    await readHealth(vercel, "/api/health", "assistant-mk1"),
    await readHealth(cloudflare, "/health/live", "assistant-mk1-control-plane"),
    await readHealth(cloudflare, "/health", "assistant-mk1-control-plane"),
    await readHealth(fly, "/health/live", "assistant-mk1-langgraph-runtime"),
    await readHealth(fly, "/health", "assistant-mk1-langgraph-runtime"),
  ];
  console.log(
    JSON.stringify({ ok: true, commit: process.env.GITHUB_SHA ?? null, checks }, null, 2),
  );
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
