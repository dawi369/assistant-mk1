export type JsonObject = Record<string, unknown>;

export class WorkbenchResponseValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "WorkbenchResponseValidationError";
  }
}

export const isJsonObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseObject = <T>(value: unknown, label: string): T => {
  if (!isJsonObject(value))
    throw new WorkbenchResponseValidationError(`${label} must be a JSON object`);
  return value as T;
};

export const parseWorkbenchResponse = <T>(value: unknown, label: string): T => {
  const object = parseObject<T>(value, label) as T & JsonObject;
  if (typeof object.ok !== "boolean") {
    throw new WorkbenchResponseValidationError(`${label}.ok must be a boolean`);
  }
  for (const field of [
    "actions",
    "agents",
    "artifacts",
    "connections",
    "devices",
    "proposals",
    "runs",
    "states",
    "threads",
    "workflows",
    "workspaces",
  ]) {
    if (field in object && !Array.isArray(object[field])) {
      throw new WorkbenchResponseValidationError(`${label}.${field} must be an array`);
    }
  }
  for (const field of ["activeAgentId", "activeWorkspaceId", "error"]) {
    if (field in object && object[field] !== undefined && typeof object[field] !== "string") {
      throw new WorkbenchResponseValidationError(`${label}.${field} must be a string`);
    }
  }
  if ("connection" in object && object.connection !== undefined && object.connection !== null) {
    if (!isJsonObject(object.connection) || object.connection.chatProtocolVersion !== 1) {
      throw new WorkbenchResponseValidationError(
        `${label}.connection uses an unsupported chat protocol`,
      );
    }
  }
  return object;
};
