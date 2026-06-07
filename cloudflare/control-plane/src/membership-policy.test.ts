import { describe, it, expect } from "vitest";

import {
  adminMembershipRoles,
  isAdminMembership,
  requireActiveMembership,
  requireAdminMembership,
} from "./membership-policy";
import type { MembershipRow } from "./types";

const makeMembership = (overrides?: Partial<MembershipRow>): MembershipRow => ({
  id: "m1",
  user_id: "u1",
  workspace_id: "w1",
  role: "member",
  status: "active",
  roles_json: "[]",
  permissions_json: "[]",
  data_json: "{}",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("adminMembershipRoles", () => {
  it("contains owner and admin", () => {
    expect(adminMembershipRoles.has("owner")).toBe(true);
    expect(adminMembershipRoles.has("admin")).toBe(true);
  });

  it("does not contain member", () => {
    expect(adminMembershipRoles.has("member")).toBe(false);
  });
});

describe("isAdminMembership", () => {
  it("returns true for active owner", () => {
    expect(isAdminMembership(makeMembership({ role: "owner" }))).toBe(true);
  });

  it("returns true for active admin", () => {
    expect(isAdminMembership(makeMembership({ role: "admin" }))).toBe(true);
  });

  it("returns true for uppercase admin (case-insensitive)", () => {
    expect(isAdminMembership(makeMembership({ role: "Admin" }))).toBe(true);
    expect(isAdminMembership(makeMembership({ role: "OWNER" }))).toBe(true);
  });

  it("returns false for regular member", () => {
    expect(isAdminMembership(makeMembership({ role: "member" }))).toBe(false);
  });

  it("returns false for inactive admin", () => {
    expect(isAdminMembership(makeMembership({ role: "admin", status: "suspended" }))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isAdminMembership(null)).toBe(false);
    expect(isAdminMembership(undefined)).toBe(false);
  });
});

describe("requireActiveMembership", () => {
  it("returns null for active membership", () => {
    expect(requireActiveMembership(makeMembership())).toBeNull();
  });

  it("returns a 403 response for inactive membership", async () => {
    const result = requireActiveMembership(makeMembership({ status: "suspended" }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    const body = await result!.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not active/i);
  });

  it("returns a 403 response for null membership", async () => {
    const result = requireActiveMembership(null);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it("returns a 403 response for undefined membership", async () => {
    const result = requireActiveMembership(undefined);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});

describe("requireAdminMembership", () => {
  it("returns null for active admin", () => {
    expect(requireAdminMembership(makeMembership({ role: "admin" }))).toBeNull();
  });

  it("returns null for active owner", () => {
    expect(requireAdminMembership(makeMembership({ role: "owner" }))).toBeNull();
  });

  it("returns a 403 response for active non-admin member", async () => {
    const result = requireAdminMembership(makeMembership({ role: "member" }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    const body = await result!.json();
    expect(body.error).toMatch(/admin/i);
  });

  it("returns a 403 response for inactive admin", async () => {
    const result = requireAdminMembership(makeMembership({ role: "admin", status: "suspended" }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it("returns a 403 for null membership", async () => {
    const result = requireAdminMembership(null);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });
});
