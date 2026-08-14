import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type {
  ArtifactSummary,
  ManagedStateSummary,
  ToolCallSummary,
} from "@assistant-mk1/workbench-client";

import { colors } from "../theme";
import { Card, Meta } from "./screen";
import {
  artifactPayload,
  artifactRendererKind,
  boundedDisplayJson,
  tableRows,
  type ArtifactRendererDescriptor,
} from "./generic-renderer-model";

export const JsonRenderer = ({ value }: { value: unknown }) => (
  <ScrollView horizontal contentContainerStyle={{ minWidth: "100%" }}>
    <Text
      selectable
      style={{ color: colors.ink, fontFamily: "monospace", fontSize: 13, lineHeight: 19 }}
    >
      {boundedDisplayJson(value)}
    </Text>
  </ScrollView>
);

export const MarkdownRenderer = ({ value }: { value: unknown }) => {
  const source = typeof value === "string" ? value : boundedDisplayJson(value);
  let inCode = false;
  return (
    <View style={{ gap: 7 }}>
      {source.split("\n").map((line, index) => {
        if (line.trim().startsWith("```")) {
          inCode = !inCode;
          return null;
        }
        if (inCode) {
          return (
            <Text
              key={index}
              selectable
              style={{ color: colors.ink, fontFamily: "monospace", fontSize: 13 }}
            >
              {line || " "}
            </Text>
          );
        }
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          return (
            <Text
              key={index}
              style={{
                color: colors.ink,
                fontSize: 21 - heading[1]!.length * 2,
                fontWeight: "700",
              }}
            >
              {heading[2]}
            </Text>
          );
        }
        const bullet = line.match(/^[-*]\s+(.+)$/);
        return (
          <Text key={index} selectable style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>
            {bullet ? `•  ${bullet[1]}` : line || " "}
          </Text>
        );
      })}
    </View>
  );
};

export const TableRenderer = ({ value }: { value: unknown }) => {
  const rows = tableRows(value);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 12);
  if (!rows.length || !columns.length) return <JsonRenderer value={value} />;
  return (
    <ScrollView horizontal>
      <View
        style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, overflow: "hidden" }}
      >
        <View style={{ flexDirection: "row", backgroundColor: colors.canvas }}>
          {columns.map((column) => (
            <Text
              key={column}
              style={{ width: 150, padding: 10, color: colors.ink, fontWeight: "700" }}
            >
              {column}
            </Text>
          ))}
        </View>
        {rows.slice(0, 100).map((row, rowIndex) => (
          <View
            key={rowIndex}
            style={{ flexDirection: "row", borderTopWidth: 1, borderColor: colors.line }}
          >
            {columns.map((column) => (
              <Text
                key={column}
                selectable
                style={{ width: 150, padding: 10, color: colors.muted }}
              >
                {typeof row[column] === "string"
                  ? row[column]
                  : boundedDisplayJson(row[column], 300)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

export const ArtifactRenderer = ({
  artifact,
  descriptor,
}: {
  artifact: ArtifactSummary;
  descriptor?: ArtifactRendererDescriptor;
}) => {
  const renderer = artifactRendererKind(artifact, descriptor);
  const value = artifactPayload(artifact.data);
  return (
    <Card>
      <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>
        {descriptor?.title ?? artifact.title ?? "Artifact"}
      </Text>
      <Meta>{artifact.kind ?? artifact.mimeType ?? "Structured output"}</Meta>
      <View style={{ marginTop: 12 }}>
        {renderer === "markdown" ? (
          <MarkdownRenderer value={value} />
        ) : renderer === "table" ? (
          <TableRenderer value={value} />
        ) : (
          <JsonRenderer value={value} />
        )}
      </View>
    </Card>
  );
};

export const ExpandableDetail = ({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value?: unknown;
  tone?: "neutral" | "danger";
}) => {
  const [open, setOpen] = useState(false);
  return (
    <View
      style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 11, gap: 8 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
      >
        <Text style={{ color: tone === "danger" ? colors.danger : colors.ink, fontWeight: "700" }}>
          {label} {open ? "−" : "+"}
        </Text>
      </Pressable>
      {open && value !== undefined ? <JsonRenderer value={value} /> : null}
    </View>
  );
};

export const ToolCallCard = ({ toolCall }: { toolCall: ToolCallSummary }) => (
  <Card>
    <Text style={{ color: colors.ink, fontWeight: "700" }}>{toolCall.toolId ?? "Tool call"}</Text>
    <Meta>{toolCall.status ?? "unknown"}</Meta>
    {toolCall.inputSummary ? (
      <Text style={{ color: colors.muted }}>{toolCall.inputSummary}</Text>
    ) : null}
    {toolCall.outputSummary ? (
      <View style={{ marginTop: 8 }}>
        <ExpandableDetail label="Result" value={toolCall.outputSummary} />
      </View>
    ) : null}
  </Card>
);

export const ReasoningBlock = ({ text }: { text: string }) =>
  text.trim() ? <ExpandableDetail label="Reasoning" value={text.trim()} /> : null;

export const ChatToolCall = ({
  toolName,
  status,
  result,
  isError,
}: {
  toolName: string;
  status?: { type?: string };
  result?: unknown;
  isError?: boolean;
}) => (
  <ExpandableDetail
    label={`${toolName} · ${status?.type ?? (result === undefined ? "running" : "complete")}`}
    value={result}
    tone={isError ? "danger" : "neutral"}
  />
);

export const ManagedStateCard = ({ state }: { state: ManagedStateSummary }) => (
  <Card>
    <Text style={{ color: colors.ink, fontSize: 17, fontWeight: "700" }}>{state.name}</Text>
    <Meta>
      {state.namespace} · {state.status} · v{state.version}
    </Meta>
    {state.summary ? (
      <Text style={{ color: colors.muted, marginBottom: 10 }}>{state.summary}</Text>
    ) : null}
    <JsonRenderer value={state.data} />
  </Card>
);
