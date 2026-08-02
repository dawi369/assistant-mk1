const retiredWorkbenchPrefixes = [
  "/api/workbench/data-export",
  "/api/workbench/cloudflare-demo-runs",
  "/api/workbench/executors/demo-inspect",
] as const;

export const isRetiredWorkbenchApiPath = (pathname: string) =>
  retiredWorkbenchPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
