type JsonRecord = Record<string, unknown>;

const redacted = "[REDACTED]";
const sensitiveKeyPattern =
  /(?:^|[-_.])(authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|password|passwd|client[-_]?secret|credential|signature|pkce|verifier|oauth[-_]?code)(?:$|[-_.])/i;
const sensitiveValuePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\bBasic\s+[A-Za-z0-9+/]+=*/i,
  /\bsk(?:_test_|_live_|-or-v1-)[A-Za-z0-9_-]{12,}/i,
  /\b(?:eyJ[A-Za-z0-9_-]{8,})\.(?:[A-Za-z0-9_-]{8,})\.(?:[A-Za-z0-9_-]{8,})\b/,
];

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sanitizeString = (value: string) =>
  sensitiveValuePatterns.some((pattern) => pattern.test(value)) ? redacted : value.slice(0, 1_024);

const sanitizeUrl = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value, "https://redacted.invalid");
    const path = `${url.pathname}${url.hash ? "#redacted" : ""}`;
    return url.origin === "https://redacted.invalid" ? path : `${url.origin}${path}`;
  } catch {
    return sanitizeString(value.split("?")[0] ?? "");
  }
};

const sanitizeValue = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, seen));
  if (!isRecord(value)) return String(value).slice(0, 256);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const sanitized: JsonRecord = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (sensitiveKeyPattern.test(key)) {
      sanitized[key] = redacted;
      continue;
    }
    sanitized[key] = sanitizeValue(item, seen);
  }
  seen.delete(value);
  return sanitized;
};

const sanitizeRequest = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  const headers = isRecord(value.headers)
    ? Object.fromEntries(
        Object.entries(value.headers)
          .filter(([name]) =>
            ["content-type", "user-agent", "x-request-id"].includes(name.toLowerCase()),
          )
          .map(([name, headerValue]) => [name, sanitizeValue(headerValue)]),
      )
    : undefined;
  return {
    url: sanitizeUrl(value.url),
    method: typeof value.method === "string" ? value.method.slice(0, 16) : undefined,
    headers,
  };
};

const sanitizeException = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value.values)) return sanitizeValue(value);
  return {
    ...value,
    values: value.values.slice(0, 20).map((exception) => {
      if (!isRecord(exception)) return sanitizeValue(exception);
      return {
        ...(sanitizeValue(exception) as JsonRecord),
        value:
          typeof exception.value === "string" ? sanitizeString(exception.value) : exception.value,
      };
    }),
  };
};

export const scrubSentryEvent = <T>(input: T): T => {
  if (!isRecord(input)) return input;
  const sanitized = sanitizeValue(input) as JsonRecord;
  delete sanitized.user;
  if ("request" in input) sanitized.request = sanitizeRequest(input.request);
  if ("exception" in input) sanitized.exception = sanitizeException(input.exception);
  if (typeof input.message === "string") sanitized.message = sanitizeString(input.message);
  return sanitized as T;
};

export const scrubSentryBreadcrumb = <T>(input: T): T => {
  if (!isRecord(input)) return input;
  const sanitized = sanitizeValue(input) as JsonRecord;
  if (typeof input.message === "string") sanitized.message = sanitizeString(input.message);
  if (isRecord(input.data) && "url" in input.data) {
    sanitized.data = { ...(sanitized.data as JsonRecord), url: sanitizeUrl(input.data.url) };
  }
  return sanitized as T;
};
