import * as Linking from "expo-linking";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useConnectionAction, useWorkbenchConnections } from "@assistant-mk1/workbench-react";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../src/components/screen";
import { colors } from "../src/theme";

export default function ConnectionsScreen() {
  const connections = useWorkbenchConnections();
  const authorize = useConnectionAction("authorize");
  const submitCredential = useConnectionAction("submitCredential");
  const health = useConnectionAction("health");
  const revoke = useConnectionAction("revoke");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const error =
    connections.error ?? authorize.error ?? submitCredential.error ?? health.error ?? revoke.error;
  return (
    <Screen refreshing={connections.isFetching} onRefresh={() => void connections.refetch()}>
      <ErrorNotice message={error instanceof Error ? error.message : null} />
      {(connections.data?.connections ?? []).map((connection) => (
        <Card key={connection.id}>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>
            {connection.provider}
          </Text>
          <Meta>
            {connection.status} · {connection.credentialClass}
          </Meta>
          {connection.credentialClass === "api_key" && connection.status !== "authorized" ? (
            <TextInput
              accessibilityLabel={`${connection.provider} API key`}
              secureTextEntry
              value={secrets[connection.id] ?? ""}
              onChangeText={(text) =>
                setSecrets((current) => ({ ...current, [connection.id]: text }))
              }
              placeholder="API key"
              placeholderTextColor={colors.muted}
              style={{
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: 14,
                padding: 12,
                color: colors.ink,
                marginTop: 12,
              }}
            />
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {connection.credentialClass === "oauth2" && connection.status !== "authorized" ? (
              <ActionButton
                label="Authorize"
                onPress={() =>
                  void authorize.mutateAsync({ connectionId: connection.id }).then((result) => {
                    if (!("authorizationUrl" in result)) {
                      throw new Error("Connection authorization did not return a redirect URL.");
                    }
                    return Linking.openURL(result.authorizationUrl);
                  })
                }
              />
            ) : null}
            {connection.credentialClass === "api_key" && connection.status !== "authorized" ? (
              <ActionButton
                label="Save"
                disabled={!secrets[connection.id]}
                onPress={() =>
                  void submitCredential
                    .mutateAsync({
                      connectionId: connection.id,
                      secret: secrets[connection.id]!,
                    })
                    .then(() => {
                      setSecrets((current) => ({ ...current, [connection.id]: "" }));
                    })
                }
              />
            ) : null}
            {connection.status === "authorized" ? (
              <ActionButton
                label="Check"
                onPress={() => void health.mutate({ connectionId: connection.id })}
              />
            ) : null}
            {connection.status === "authorized" ? (
              <ActionButton
                label="Revoke"
                destructive
                onPress={() => void revoke.mutate({ connectionId: connection.id })}
              />
            ) : null}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
