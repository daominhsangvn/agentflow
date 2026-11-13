import { beforeEach, describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    authMember: { findFirst: vi.fn() },
    authOrganizationRole: { findMany: vi.fn() },
  },
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (client: typeof db) => unknown) => fn(db),
}));
vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/route-utils", () => ({
  forbiddenResponse: () => new Response(null, { status: 403 }),
  scheduleLogFlush: vi.fn(),
}));

import {
  BuiltInOrgRole,
  OrgPermission,
} from "@repo/api/src/types/org-permissions";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
import {
  getOrgPermissionStatus,
  hasOrgPermission,
  isOrgOwner,
  resolveMemberPermissions,
} from "@/lib/auth/org-permissions";

const ALL = Object.values(OrgPermission);

describe("resolveMemberPermissions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives an owner and an admin every grantable permission", async () => {
    expect(await resolveMemberPermissions(BuiltInOrgRole.Owner, "o")).toEqual(
      expect.arrayContaining(ALL)
    );
    expect(
      (await resolveMemberPermissions(BuiltInOrgRole.Admin, "o")).sort()
    ).toEqual([...ALL].sort());
  });

  it("gives a member nothing and skips the role lookup", async () => {
    expect(await resolveMemberPermissions(BuiltInOrgRole.Member, "o")).toEqual(
      []
    );
    expect(db.authOrganizationRole.findMany).not.toHaveBeenCalled();
  });

  it("reads custom roles from the database", async () => {
    db.authOrganizationRole.findMany.mockResolvedValueOnce([
      {
        permission: JSON.stringify({
          workflow: ["manage"],
          member: ["update", "bogus"],
          unknown: ["x"],
        }),
      },
    ]);
    const perms = await resolveMemberPermissions("reviewer", "o");
    expect(perms.sort()).toEqual(
      [OrgPermission.WorkflowManage, OrgPermission.MemberUpdate].sort()
    );
  });

  it("ignores corrupt or unknown custom roles", async () => {
    db.authOrganizationRole.findMany.mockResolvedValueOnce([
      { permission: "{not json" },
      { permission: JSON.stringify(["a"]) },
    ]);
    expect(await resolveMemberPermissions("broken", "o")).toEqual([]);
    db.authOrganizationRole.findMany.mockResolvedValueOnce([]);
    expect(await resolveMemberPermissions("ghost", "o")).toEqual([]);
  });

  it("unions comma-joined roles", async () => {
    db.authOrganizationRole.findMany.mockResolvedValueOnce([
      { permission: JSON.stringify({ customField: ["manage"] }) },
    ]);
    const perms = await resolveMemberPermissions("member,ops", "o");
    expect(perms).toEqual([OrgPermission.CustomFieldManage]);
  });
});

describe("getOrgPermissionStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports non-members", async () => {
    db.authMember.findFirst.mockResolvedValueOnce(null);
    expect(await getOrgPermissionStatus("o", "u")).toEqual({
      kind: "not_member",
    });
  });

  it("reports a provider error when the database throws", async () => {
    db.authMember.findFirst.mockRejectedValueOnce(new Error("down"));
    expect(await getOrgPermissionStatus("o", "u")).toEqual({
      kind: "provider_error",
    });
  });

  it("flags owners and always permits them", async () => {
    db.authMember.findFirst.mockResolvedValue({ role: "owner" });
    expect(await isOrgOwner("o", "u")).toBe(true);
    expect(await hasOrgPermission("o", "u", OrgPermission.ProjectManage)).toBe(
      true
    );
    db.authMember.findFirst.mockResolvedValue({ role: "member" });
    expect(await isOrgOwner("o", "u")).toBe(false);
    expect(await hasOrgPermission("o", "u", OrgPermission.ProjectManage)).toBe(
      false
    );
  });
});

describe("denyUnlessPermitted", () => {
  beforeEach(() => vi.clearAllMocks());
  const auth = { clerkOrgId: "o", clerkUserId: "u" };
  const req = { method: "POST", route: "/x" };

  it("returns null when permitted", async () => {
    db.authMember.findFirst.mockResolvedValueOnce({ role: "admin" });
    expect(
      await denyUnlessPermitted(auth, req, OrgPermission.WorkflowManage)
    ).toBeNull();
  });

  it("returns 403 when the permission is missing, not a member or on error", async () => {
    db.authMember.findFirst.mockResolvedValueOnce({ role: "member" });
    expect(
      (await denyUnlessPermitted(auth, req, OrgPermission.WorkflowManage))
        ?.status
    ).toBe(403);
    db.authMember.findFirst.mockResolvedValueOnce(null);
    expect(
      (await denyUnlessPermitted(auth, req, OrgPermission.WorkflowManage))
        ?.status
    ).toBe(403);
    db.authMember.findFirst.mockRejectedValueOnce(new Error("x"));
    expect(
      (await denyUnlessPermitted(auth, req, OrgPermission.WorkflowManage))
        ?.status
    ).toBe(403);
  });
});
