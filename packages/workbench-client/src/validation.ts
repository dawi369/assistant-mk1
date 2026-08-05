export type JsonObject = Record<string, unknown>;

export const isJsonObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseObject = <T>(value: unknown, label: string): T => {
  if (!isJsonObject(value)) throw new TypeError(`${label} must be a JSON object`);
  return value as T;
};

export const parseWorkbenchResponse = <T>(value: unknown, label: string): T => {
  const object = parseObject<T>(value, label) as T & JsonObject;
  if (typeof object.ok !== "boolean") {
    throw new TypeError(`${label}.ok must be a boolean`);
  }
  for (const field of [
    "actions",
    "agents",
    "artifacts",
    "connections",
    "proposals",
    "runs",
    "states",
    "threads",
    "workspaces",
  ]) {
    if (field in object && !Array.isArray(object[field])) {
      throw new TypeError(`${label}.${field} must be an array`);
    }
  }
  for (const field of ["activeAgentId", "activeWorkspaceId", "error"]) {
    if (field in object && object[field] !== undefined && typeof object[field] !== "string") {
      throw new TypeError(`${label}.${field} must be a string`);
    }
  }
  return object;
};
