export type SchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};

export type SchemaFormValue = Record<string, string | boolean>;

export const schemaProperties = (schema: Record<string, unknown>) =>
  schema.properties && typeof schema.properties === "object"
    ? (schema.properties as Record<string, SchemaProperty>)
    : {};

export const schemaFormDefaults = (schema: Record<string, unknown>): SchemaFormValue =>
  Object.fromEntries(
    Object.entries(schemaProperties(schema)).flatMap(([name, property]) =>
      property.default === undefined
        ? []
        : [
            [
              name,
              property.type === "boolean" ? Boolean(property.default) : String(property.default),
            ],
          ],
    ),
  );

export const schemaFormInput = (schema: Record<string, unknown>, values: SchemaFormValue) => {
  const properties = schemaProperties(schema);
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const name of required) {
    if (!(name in values) || values[name] === "") {
      throw new Error(`${properties[String(name)]?.title ?? String(name)} is required.`);
    }
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const property = properties[key];
      const type = property?.type;
      if (type === "number" || type === "integer") {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`${property.title ?? key} must be a number.`);
        if (property.minimum !== undefined && number < property.minimum) {
          throw new Error(`${property.title ?? key} must be at least ${property.minimum}.`);
        }
        if (property.maximum !== undefined && number > property.maximum) {
          throw new Error(`${property.title ?? key} must be at most ${property.maximum}.`);
        }
        return [key, number];
      }
      if ((type === "object" || type === "array") && typeof value === "string") {
        try {
          return [key, JSON.parse(value) as unknown];
        } catch {
          throw new Error(`${property.title ?? key} must contain valid JSON.`);
        }
      }
      if (typeof value === "string" && property?.minLength && value.length < property.minLength) {
        throw new Error(`${property.title ?? key} is too short.`);
      }
      if (typeof value === "string" && property?.maxLength && value.length > property.maxLength) {
        throw new Error(`${property.title ?? key} is too long.`);
      }
      const enumValue = property?.enum?.find((candidate) => String(candidate) === value);
      if (enumValue !== undefined) return [key, enumValue];
      return [key, value];
    }),
  );
};
