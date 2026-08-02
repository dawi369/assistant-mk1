export const resolveLegacyLangGraphApiKey = (input: { apiKey?: string; nodeEnv?: string }) => {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) return undefined;
  if (input.nodeEnv === "production") {
    throw new Error(
      "Hosted LangGraph proxy requests require the signed Cloudflare facade configuration",
    );
  }
  return apiKey;
};
