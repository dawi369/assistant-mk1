import { json } from "./http";
import type { MembershipRow } from "./types";

export const adminMembershipRoles = new Set(["owner", "admin"]);

export const isAdminMembership = (membership: MembershipRow | null | undefined) =>
  Boolean(
    membership?.status === "active" && adminMembershipRoles.has(membership.role.toLowerCase()),
  );

export const requireActiveMembership = (membership: MembershipRow | null | undefined) => {
  if (!membership || membership.status !== "active") {
    return json({ ok: false, error: "Workspace membership is not active" }, { status: 403 });
  }
  return null;
};

export const requireAdminMembership = (membership: MembershipRow | null | undefined) => {
  const activeError = requireActiveMembership(membership);
  if (activeError) return activeError;

  if (!isAdminMembership(membership)) {
    return json({ ok: false, error: "Workspace admin role is required" }, { status: 403 });
  }

  return null;
};
