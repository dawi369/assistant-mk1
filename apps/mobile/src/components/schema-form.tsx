import { Pressable, Switch, Text, TextInput, View } from "react-native";

import { colors } from "../theme";
import { schemaProperties, type SchemaFormValue } from "./schema-form-model";

export { schemaFormDefaults, schemaFormInput, type SchemaFormValue } from "./schema-form-model";

export const SchemaForm = ({
  schema,
  values,
  onChange,
}: {
  schema: Record<string, unknown>;
  values: SchemaFormValue;
  onChange: (values: SchemaFormValue) => void;
}) => {
  const properties = schemaProperties(schema);
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
          {property.enum?.length ? (
            <View
              accessibilityRole="radiogroup"
              style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
            >
              {property.enum.map((option) => {
                const selected = values[name] === String(option);
                return (
                  <Pressable
                    key={String(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => onChange({ ...values, [name]: String(option) })}
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? colors.accent : colors.line,
                      backgroundColor: selected ? colors.accentSoft : colors.surface,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                    }}
                  >
                    <Text style={{ color: colors.ink }}>{String(option)}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : property.type === "boolean" ? (
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
                  : property.format === "email"
                    ? "email-address"
                    : property.format === "uri" || property.format === "url"
                      ? "url"
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
