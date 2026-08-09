import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { ActionButton, ErrorNotice, Screen } from "../../src/components/screen";
import {
  SchemaForm,
  schemaFormInput,
  type SchemaFormValue,
} from "../../src/components/schema-form";
import { useMobileResource } from "../../src/hooks/use-mobile-resource";
import { useWorkbench } from "../../src/workbench-provider";

export default function WorkflowScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const { client } = useWorkbench();
  const load = useCallback(() => client.workflows.list(), [client]);
  const discovery = useMobileResource(load);
  const workflow = useMemo(
    () => discovery.data?.workflows.find((candidate) => candidate.type === type),
    [discovery.data, type],
  );
  const [input, setInput] = useState<SchemaFormValue>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      if (!workflow) throw new Error("Workflow is unavailable for the active agent.");
      const response = await client.workflows.run(type, {
        input: schemaFormInput(workflow.inputSchema, input),
        executionMode: "dry_run",
      });
      const runId = response.run?.id;
      if (runId) router.replace({ pathname: "/run/[id]", params: { id: runId } });
      else router.back();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Workflow failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title={workflow?.label ?? type}
      subtitle={
        workflow?.description ??
        "Generic schema input. Mutation execution remains policy-controlled and online-only."
      }
      refreshing={discovery.refreshing}
      onRefresh={() => void discovery.refresh()}
    >
      <ErrorNotice message={error ?? discovery.error} />
      <View style={{ marginHorizontal: 16, gap: 14 }}>
        {workflow ? (
          <SchemaForm schema={workflow.inputSchema} values={input} onChange={setInput} />
        ) : null}
        <ActionButton
          label={busy ? "Running…" : "Run workflow"}
          disabled={busy || !workflow}
          onPress={() => void run()}
        />
      </View>
    </Screen>
  );
}
