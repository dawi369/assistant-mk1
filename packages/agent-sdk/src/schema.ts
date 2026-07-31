import type { JsonSchema } from "./runtime";

export type SchemaIssue = {
  path: string;
  message: string;
};

const typeOf = (value: unknown) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
};

const supportedSchemaTypes = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

export const validateSchemaDefinition = (schema: JsonSchema, path = "$"): SchemaIssue[] => {
  const issues: SchemaIssue[] = [];
  if (typeof schema.type !== "string" || !supportedSchemaTypes.has(schema.type)) {
    issues.push({ path: `${path}.type`, message: "must declare a supported JSON Schema type" });
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) || schema.required.some((item) => typeof item !== "string"))
  ) {
    issues.push({ path: `${path}.required`, message: "must be an array of property names" });
  }
  if (
    schema.properties !== undefined &&
    (!schema.properties ||
      typeof schema.properties !== "object" ||
      Array.isArray(schema.properties))
  ) {
    issues.push({ path: `${path}.properties`, message: "must be an object" });
  } else if (schema.properties && typeof schema.properties === "object") {
    for (const [name, child] of Object.entries(schema.properties)) {
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        issues.push({ path: `${path}.properties.${name}`, message: "must be a schema object" });
      } else {
        issues.push(...validateSchemaDefinition(child as JsonSchema, `${path}.properties.${name}`));
      }
    }
  }
  if (schema.items !== undefined) {
    if (!schema.items || typeof schema.items !== "object" || Array.isArray(schema.items)) {
      issues.push({ path: `${path}.items`, message: "must be a schema object" });
    } else {
      issues.push(...validateSchemaDefinition(schema.items as JsonSchema, `${path}.items`));
    }
  }
  if (schema.pattern !== undefined && typeof schema.pattern === "string") {
    try {
      new RegExp(schema.pattern);
    } catch {
      issues.push({ path: `${path}.pattern`, message: "must be a valid regular expression" });
    }
  }
  return issues;
};

export const assertSchemaDefinition = (schema: JsonSchema, label: string): void => {
  const issues = validateSchemaDefinition(schema);
  if (issues.length) {
    const detail = issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
    throw Object.assign(new Error(`${label} is not a supported JSON Schema: ${detail}`), {
      code: "schema_definition_invalid",
      issues,
    });
  }
};

export const validateSchemaValue = (
  schema: JsonSchema,
  value: unknown,
  path = "$",
): SchemaIssue[] => {
  const issues: SchemaIssue[] = [];
  const expected = schema.type;
  if (typeof expected === "string") {
    const actual = typeOf(value);
    const matches =
      expected === actual ||
      (expected === "number" && actual === "integer") ||
      (expected === "object" && actual === "object");
    if (!matches) return [{ path, message: `expected ${expected}, received ${actual}` }];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) {
    issues.push({ path, message: "value is not in the declared enum" });
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      issues.push({ path, message: `must contain at least ${schema.minLength} characters` });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      issues.push({ path, message: `must contain at most ${schema.maxLength} characters` });
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      issues.push({ path, message: "does not match the declared pattern" });
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push({ path, message: `must be at least ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      issues.push({ path, message: `must be at most ${schema.maximum}` });
    }
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    value.forEach((item, index) => {
      issues.push(...validateSchemaValue(schema.items as JsonSchema, item, `${path}[${index}]`));
    });
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, JsonSchema>)
        : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    for (const key of required) {
      if (!(key in record)) issues.push({ path: `${path}.${key}`, message: "is required" });
    }
    for (const [key, item] of Object.entries(record)) {
      if (properties[key]) {
        issues.push(...validateSchemaValue(properties[key], item, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        issues.push({ path: `${path}.${key}`, message: "is not declared" });
      }
    }
  }
  return issues;
};

export const assertSchemaValue = (schema: JsonSchema, value: unknown, label: string): void => {
  const issues = validateSchemaValue(schema, value);
  if (issues.length) {
    const detail = issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
    throw Object.assign(new Error(`${label} failed schema validation: ${detail}`), {
      code: "schema_validation_failed",
      issues,
    });
  }
};
