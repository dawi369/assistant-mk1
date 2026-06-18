export const adminSummaryProjections = ["compact", "drawer"] as const;
export type AdminSummaryProjection = (typeof adminSummaryProjections)[number];

export const defaultAdminSummaryProjection = "drawer" satisfies AdminSummaryProjection;

export const isAdminSummaryProjection = (value: string): value is AdminSummaryProjection =>
  adminSummaryProjections.includes(value as AdminSummaryProjection);

export const readAdminSummaryProjection = (
  value: string | null | undefined,
  fallback: AdminSummaryProjection = defaultAdminSummaryProjection,
) => {
  const normalized = value?.trim();
  return normalized && isAdminSummaryProjection(normalized) ? normalized : fallback;
};

export const adminSummaryProjectionPath = (projection?: AdminSummaryProjection) => {
  if (!projection) return "/admin/workspace-summary";
  return `/admin/workspace-summary?projection=${encodeURIComponent(projection)}`;
};
