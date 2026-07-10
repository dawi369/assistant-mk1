import { describe, expect, it } from "vitest";

import { evaluateMembershipUpdate } from "./membership-policy";
import type { MembershipRow } from "./types";

const timestamp = "2026-07-09T00:00:00.000Z";

const membership = (userId: string, role: string, status = "active"): MembershipRow => ({
  id: `membership-${userId}`,
  user_id: userId,
  workspace_id: "workspace-1",
  role,
  status,
  roles_json: JSON.stringify([role]),
  permissions_json: "[]",
  data_json: "{}",
  created_at: timestamp,
  updated_at: timestamp,
});

describe("workspace membership policy", () => {
  it("allows owners to manage another member", () => {
    expect(
      evaluateMembershipUpdate({
        actor: membership("owner-1", "owner"),
        target: membership("member-1", "member"),
        role: "admin",
        status: "active",
        activeOwnerCount: 1,
      }),
    ).toEqual({ ok: true });
  });

  it("keeps admins from editing owners or granting owner", () => {
    expect(
      evaluateMembershipUpdate({
        actor: membership("admin-1", "admin"),
        target: membership("owner-1", "owner"),
        role: "member",
        status: "active",
        activeOwnerCount: 2,
      }),
    ).toMatchObject({ ok: false });
    expect(
      evaluateMembershipUpdate({
        actor: membership("admin-1", "admin"),
        target: membership("member-1", "member"),
        role: "owner",
        status: "active",
        activeOwnerCount: 1,
      }),
    ).toMatchObject({ ok: false });
  });

  it("prevents self-lockout and removal of the final active owner", () => {
    expect(
      evaluateMembershipUpdate({
        actor: membership("owner-1", "owner"),
        target: membership("owner-1", "owner"),
        role: "member",
        status: "active",
        activeOwnerCount: 2,
      }),
    ).toEqual({ ok: false, error: "Ask another workspace owner to change your access" });
    expect(
      evaluateMembershipUpdate({
        actor: membership("owner-2", "owner"),
        target: membership("owner-1", "owner"),
        role: "member",
        status: "active",
        activeOwnerCount: 1,
      }),
    ).toEqual({ ok: false, error: "A workspace must keep at least one active owner" });
  });
});
