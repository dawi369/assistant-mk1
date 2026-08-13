// Vercel intentionally rolls the bounded SSE response. Preserve the live UI
// through a clean rollover; only transport failures should surface disconnect state.
export const sessionStreamReconnectPlan = (failed: boolean) => ({
  delayMs: failed ? 2_000 : 100,
  markDisconnected: failed,
});
