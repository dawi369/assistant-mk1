export type UrlInspectError = {
  code: string;
  message: string;
  retryable: boolean;
  redacted: true;
};

export type UrlInspectOutput = {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string | null;
  contentLength: number | null;
  downloadedBytes: number;
  truncated: boolean;
  title: string | null;
  timingMs: number;
  summary: string;
  retryable: boolean;
};

export type UrlInspectResult =
  | { ok: true; output: UrlInspectOutput }
  | { ok: false; error: UrlInspectError };

const urlInspectTimeoutMs = 5_000;
const urlInspectMaxBytes = 128 * 1024;

export const urlInspectError = (
  code: string,
  message: string,
  retryable = false,
): UrlInspectError => ({
  code,
  message,
  retryable,
  redacted: true,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPrivateIpv4 = (hostname: string) => {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const isBlockedHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv6 = normalized.includes(":");
  return (
    normalized === "localhost" ||
    normalized === "metadata" ||
    normalized === "metadata.google.internal" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    (isIpv6 &&
      (normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80:"))) ||
    isPrivateIpv4(normalized)
  );
};

export const validateUrlInspectInput = (
  input: unknown,
): { ok: true; url: URL } | { ok: false; status: 400 | 403; error: UrlInspectError } => {
  const rawUrl = isRecord(input) && typeof input.url === "string" ? input.url.trim() : "";
  if (!rawUrl) {
    return {
      ok: false,
      status: 400,
      error: urlInspectError("invalid_input", "input.url is required.", false),
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      status: 400,
      error: urlInspectError("invalid_url", "URL must be an absolute http or https URL.", false),
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      status: 400,
      error: urlInspectError(
        "unsupported_protocol",
        "Only http and https URLs can be inspected.",
        false,
      ),
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      status: 400,
      error: urlInspectError(
        "url_credentials_rejected",
        "URLs with embedded credentials are rejected.",
        false,
      ),
    };
  }

  if (isBlockedHostname(url.hostname)) {
    return {
      ok: false,
      status: 403,
      error: urlInspectError(
        "url_blocked",
        "Local, private, and metadata hosts cannot be inspected.",
        false,
      ),
    };
  }

  return { ok: true, url };
};

const extractTitle = (text: string) => {
  const match = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  return match[1].replace(/\s+/g, " ").trim().slice(0, 180) || null;
};

const concatChunks = (chunks: Uint8Array[], totalBytes: number) => {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
};

const readBoundedText = async (response: Response) => {
  if (!response.body) return { text: "", downloadedBytes: 0, truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;
  let truncated = false;

  try {
    while (downloadedBytes < urlInspectMaxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = urlInspectMaxBytes - downloadedBytes;
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining));
        downloadedBytes += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      downloadedBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
    if (truncated) await response.body.cancel().catch(() => undefined);
  }

  return {
    text: new TextDecoder().decode(concatChunks(chunks, downloadedBytes)),
    downloadedBytes,
    truncated,
  };
};

export const inspectUrl = async (url: URL): Promise<UrlInspectResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), urlInspectTimeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.8,*/*;q=0.5",
      },
    });
    const contentType = response.headers.get("content-type");
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
    const readableLength = Number.isFinite(contentLength) ? contentLength : null;
    const body = await readBoundedText(response);
    const isHtml = contentType?.toLowerCase().includes("html") ?? false;
    const title = isHtml ? extractTitle(body.text) : null;
    const timingMs = Date.now() - startedAt;
    const summary = `${response.status} ${response.statusText || ""}`.trim();

    return {
      ok: true,
      output: {
        url: url.toString(),
        finalUrl: response.url,
        status: response.status,
        ok: response.ok,
        contentType,
        contentLength: readableLength,
        downloadedBytes: body.downloadedBytes,
        truncated: body.truncated,
        title,
        timingMs,
        summary: title ? `${summary}: ${title}` : summary,
        retryable: response.status >= 500 || response.status === 429,
      },
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: urlInspectError(
        aborted ? "url_inspect_timeout" : "url_inspect_failed",
        aborted
          ? `URL inspection timed out after ${urlInspectTimeoutMs}ms.`
          : "URL inspection failed before a response was available.",
        true,
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
};
