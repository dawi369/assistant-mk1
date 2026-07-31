import { agentManifestRegistry } from "../../generated/agent-runtime/manifests";
import { agentWebRegistry } from "../../generated/agent-runtime/web";

const sensitiveKey = /(authorization|cookie|credential|password|secret|token)/i;

export const sanitizeRendererValue = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return "[depth-limited]";
  if (typeof value === "string") return value.slice(0, 16_384);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeRendererValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !sensitiveKey.test(key))
      .slice(0, 200)
      .map(([key, item]) => [key, sanitizeRendererValue(item, depth + 1)]),
  );
};

export const resolveArtifactRenderer = (artifactKind?: string) => {
  if (!artifactKind) return null;
  for (const [packId, entry] of Object.entries(agentWebRegistry)) {
    const renderer = (entry.module.artifactRenderers as Record<string, unknown>)[artifactKind];
    if (renderer) {
      const manifest = agentManifestRegistry[packId as keyof typeof agentManifestRegistry]?.module;
      return {
        packId,
        runtimeVersion: entry.module.runtimeVersion,
        descriptor: manifest?.artifactRenderers.find(
          (candidate) => candidate.artifactKind === artifactKind,
        ),
        renderer,
      };
    }
  }
  return null;
};
