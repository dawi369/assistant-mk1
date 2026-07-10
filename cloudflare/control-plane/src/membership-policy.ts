import { json } from "./http";
import type { MembershipRow } from "./types";

export const adminMembershipRoles = new Set(["owner", "admin"]);
export const workspaceMembershipRoles = ["owner", "admin", "member"] as const;
export const workspaceMembershipStatuses = ["active", "disabled"] as const;

export type WorkspaceMembershipRole = (typeof workspaceMembershipRoles)[number];
export type WorkspaceMembershipStatus = (typeof workspaceMembershipStatuses)[number];

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

export const evaluateMembershipUpdate = (input: {
  actor: MembershipRow;
  target: MembershipRow;
  role: WorkspaceMembershipRole;
  status: WorkspaceMembershipStatus;
  activeOwnerCount: number;
}): { ok: true } | { ok: false; error: string } => {
  const actorRole = input.actor.role.toLowerCase();
  const targetRole = input.target.role.toLowerCase();

  if (input.actor.user_id === input.target.user_id) {
    return { ok: false, error: "Ask another workspace owner to change your access" };
  }

  if (actorRole === "admin" && (targetRole !== "member" || input.role === "owner")) {
    return { ok: false, error: "Workspace admins can only manage member access" };
  }

  const removesActiveOwner =
    targetRole === "owner" &&
    input.target.status === "active" &&
    (input.role !== "owner" || input.status !== "active");
  if (removesActiveOwner && input.activeOwnerCount <= 1) {
    return { ok: false, error: "A workspace must keep at least one active owner" };
  }

  return { ok: true };
};
