import { Switch, Text, TextInput, View } from "react-native";

import { colors } from "../theme";

type SchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
};

export type SchemaFormValue = Record<string, string | boolean>;

export const schemaFormInput = (schema: Record<string, unknown>, values: SchemaFormValue) => {
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, SchemaProperty>)
      : {};
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const type = properties[key]?.type;
      if (type === "number" || type === "integer") return [key, Number(value)];
      if ((type === "object" || type === "array") && typeof value === "string") {
        return [key, JSON.parse(value) as unknown];
      }
      return [key, value];
    }),
  );
};

export const SchemaForm = ({
  schema,
  values,
  onChange,
}: {
  schema: Record<string, unknown>;
  values: SchemaFormValue;
  onChange: (values: SchemaFormValue) => void;
}) => {
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, SchemaProperty>)
      : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return (
    <View style={{ gap: 16 }}>
      {Object.entries(properties).map(([name, property]) => (
        <View key={name} style={{ gap: 6 }}>
          <Text style={{ color: colors.ink, fontWeight: "700" }}>
            {property.title ?? name}
            {required.has(name) ? " *" : ""}
          </Text>
          {property.description ? (
            <Text style={{ color: colors.muted, lineHeight: 19 }}>{property.description}</Text>
          ) : null}
          {property.type === "boolean" ? (
            <Switch
              accessibilityLabel={property.title ?? name}
              value={values[name] === true}
              onValueChange={(value) => onChange({ ...values, [name]: value })}
              trackColor={{ true: colors.accentSoft }}
              thumbColor={colors.accent}
            />
          ) : (
            <TextInput
              accessibilityLabel={property.title ?? name}
              value={typeof values[name] === "string" ? values[name] : ""}
              onChangeText={(value) => onChange({ ...values, [name]: value })}
              placeholder={
                property.enum?.join(" | ") ??
                (property.default === undefined ? undefined : String(property.default))
              }
              placeholderTextColor={colors.muted}
              keyboardType={
                property.type === "number" || property.type === "integer"
                  ? "decimal-pad"
                  : "default"
              }
              multiline={property.type === "object" || property.type === "array"}
              autoCapitalize="none"
              style={{
                minHeight: property.type === "object" || property.type === "array" ? 100 : 46,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.surface,
                color: colors.ink,
                padding: 12,
                textAlignVertical: "top",
              }}
            />
          )}
        </View>
      ))}
    </View>
  );
};
