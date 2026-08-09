import * as Linking from "expo-linking";
import { useCallback, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { ActionButton, Card, ErrorNotice, Meta, Screen } from "../src/components/screen";
import { useMobileResource } from "../src/hooks/use-mobile-resource";
import { colors } from "../src/theme";
import { useWorkbench } from "../src/workbench-provider";

export default function ConnectionsScreen() {
  const { client } = useWorkbench();
  const load = useCallback(() => client.connections.list(), [client]);
  const { data, error, refreshing, refresh } = useMobileResource(load);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <ErrorNotice message={error} />
      {(data?.connections ?? []).map((connection) => (
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
                  void client.connections
                    .authorize(connection.id)
                    .then((result) => Linking.openURL(result.authorizationUrl))
                }
              />
            ) : null}
            {connection.credentialClass === "api_key" && connection.status !== "authorized" ? (
              <ActionButton
                label="Save"
                disabled={!secrets[connection.id]}
                onPress={() =>
                  void client.connections
                    .submitCredential(connection.id, secrets[connection.id]!)
                    .then(() => {
                      setSecrets((current) => ({ ...current, [connection.id]: "" }));
                      return refresh();
                    })
                }
              />
            ) : null}
            {connection.status === "authorized" ? (
              <ActionButton
                label="Check"
                onPress={() => void client.connections.health(connection.id).then(() => refresh())}
              />
            ) : null}
            {connection.status === "authorized" ? (
              <ActionButton
                label="Revoke"
                destructive
                onPress={() => void client.connections.revoke(connection.id).then(() => refresh())}
              />
            ) : null}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
