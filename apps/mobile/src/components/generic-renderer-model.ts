import type { AgentPackTemplateMetadata, ArtifactSummary } from "@assistant-mk1/workbench-client";

export type ArtifactRendererDescriptor = NonNullable<
  AgentPackTemplateMetadata["artifactRenderers"]
>[number];

export const boundedDisplayJson = (value: unknown, limit = 12_000) => {
  const serialized = JSON.stringify(value, null, 2) ?? String(value);
  return serialized.length > limit ? `${serialized.slice(0, limit)}\n…` : serialized;
};

export const artifactPayload = (data: Record<string, unknown> | undefined) => {
  if (!data) return null;
  for (const key of ["content", "markdown", "report", "rows", "value"]) {
    if (key in data) return data[key];
  }
  return data;
};

export const artifactRendererKind = (
  artifact: ArtifactSummary,
  descriptor?: ArtifactRendererDescriptor,
) =>
  descriptor?.renderer ??
  (artifact.mimeType === "text/markdown"
    ? "markdown"
    : artifact.mimeType === "text/csv"
      ? "table"
      : "json");

export const tableRows = (value: unknown): Record<string, unknown>[] => {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
      ? value.rows
      : [];
  return rows.filter((row): row is Record<string, unknown> =>
    Boolean(row && typeof row === "object" && !Array.isArray(row)),
  );
};
