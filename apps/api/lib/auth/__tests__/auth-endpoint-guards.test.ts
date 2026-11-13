import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { invitationToken } from "@/lib/auth/invitation-token";
import {
  type AuthTestInstance,
  createAuthTestInstance,
} from "../../../__tests__/support/auth/better-auth.test-harness";

describe("invitation token guard (real Better Auth)", () => {
  let h: AuthTestInstance;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-for-guards");
    h = await createAuthTestInstance();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function setup() {
    const owner = await h.signUp("owner@x.test");
    const org = await h.createOrg(owner.headers, "acme");
    const peer = await h.signUp("peer@x.test");
    const invitee = await h.signUp("b@x.test");
    await h.invite(owner.headers, {
      email: "b@x.test",
      role: "member",
      organizationId: org.id,
    });
    const invitationId = h.sentInvitations.at(-1)?.id ?? "";
    return { owner, org, peer, invitee, invitationId };
  }

  async function userEmailVerified(userId: string): Promise<boolean> {
    const user = await h.db.findOne<{ emailVerified: boolean }>({
      model: "user",
      where: [{ field: "id", value: userId }],
    });
    return user?.emailVerified === true;
  }

  async function isMember(userId: string, organizationId: string) {
    const row = await h.db.findOne({
      model: "member",
      where: [
        { field: "userId", value: userId },
        { field: "organizationId", value: organizationId },
      ],
    });
    return row !== null;
  }

  it("requires the signed token to read, accept and reject", async () => {
    const { owner, org, invitee, invitationId } = await setup();
    const token = invitationToken(invitationId);

    // The id is visible to any member, so it is not a credential.
    const full = await h.get(
      "/organization/get-full-organization",
      owner.headers,
      {
        organizationId: org.id,
      }
    );
    expect(JSON.stringify(full.data)).toContain(invitationId);

    const noToken = await h.get(
      "/organization/get-invitation",
      invitee.headers,
      {
        id: invitationId,
      }
    );
    expect(noToken.status).toBe(400);
    const wrong = await h.get("/organization/get-invitation", invitee.headers, {
      id: invitationId,
      token: "nope",
    });
    expect(wrong.status).toBe(400);
    const ok = await h.get("/organization/get-invitation", invitee.headers, {
      id: invitationId,
      token,
    });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.data)).toContain("acme");

    const refused = await h.post(
      "/organization/accept-invitation",
      invitee.headers,
      {
        invitationId,
      }
    );
    expect(refused.status).toBe(400);
    expect(await isMember(invitee.userId, org.id)).toBe(false);
    expect(await userEmailVerified(invitee.userId)).toBe(false);
    const pending = await h.db.findOne<{ status: string }>({
      model: "invitation",
      where: [{ field: "id", value: invitationId }],
    });
    expect(pending?.status).toBe("pending");

    const accepted = await h.post(
      "/organization/accept-invitation",
      invitee.headers,
      {
        invitationId,
        token,
      }
    );
    expect(accepted.status).toBe(200);
    expect(await isMember(invitee.userId, org.id)).toBe(true);
    expect(await userEmailVerified(invitee.userId)).toBe(true);
  });

  it("guards reject the same way", async () => {
    const { owner, org, invitee, invitationId } = await setup();
    const withoutToken = await h.post(
      "/organization/reject-invitation",
      invitee.headers,
      {
        invitationId,
      }
    );
    expect(withoutToken.status).toBe(400);

    const second = await h.signUp("c@x.test");
    await h.invite(owner.headers, {
      email: "c@x.test",
      role: "member",
      organizationId: org.id,
    });
    const secondId = h.sentInvitations.at(-1)?.id ?? "";
    const rejected = await h.post(
      "/organization/reject-invitation",
      second.headers,
      {
        invitationId: secondId,
        token: invitationToken(secondId),
      }
    );
    expect(rejected.status).toBe(200);
  });

  it("keeps the token valid when an invitation is resent", async () => {
    const { owner, org, invitee, invitationId } = await setup();
    const token = invitationToken(invitationId);
    const resent = await h.invite(owner.headers, {
      email: "b@x.test",
      role: "member",
      organizationId: org.id,
      resend: true,
    });
    expect(resent.status).toBe(200);
    expect(h.sentInvitations.at(-1)?.id).toBe(invitationId);
    const ok = await h.get("/organization/get-invitation", invitee.headers, {
      id: invitationId,
      token,
    });
    expect(ok.status).toBe(200);
  });
});

describe("role assignment guard (real Better Auth)", () => {
  let h: AuthTestInstance;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-for-guards");
    h = await createAuthTestInstance();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function addMember(
    organizationId: string,
    email: string,
    role: string
  ) {
    const user = await h.signUp(email);
    const memberId = await h.addMember(organizationId, user.userId, role);
    return { ...user, memberId };
  }

  async function setup() {
    const owner = await h.signUp("owner@x.test");
    const org = await h.createOrg(owner.headers, "acme");
    const role = await h.post("/organization/create-role", owner.headers, {
      role: "helper",
      permission: { invitation: ["create"], member: ["update"] },
      organizationId: org.id,
    });
    if (role.status !== 200) {
      throw new Error(`create-role failed with ${role.status}`);
    }
    const b = await addMember(org.id, "b@x.test", "helper");
    const c = await addMember(org.id, "c@x.test", "member");
    const d = await addMember(org.id, "d@x.test", "admin");
    return { owner, org, b, c, d };
  }

  it("limits a custom-role caller to roles within its own permissions", async () => {
    const { org, b, c, d } = await setup();
    const asAdmin = await h.invite(b.headers, {
      email: "n1@x.test",
      role: "admin",
      organizationId: org.id,
    });
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.code).toBe("ROLE_NOT_ASSIGNABLE");
    for (const role of ["member", "helper"]) {
      const ok = await h.invite(b.headers, {
        email: `${role}@x.test`,
        role,
        organizationId: org.id,
      });
      expect(ok.status).toBe(200);
    }

    const update = (headers: Headers, memberId: string, role: string) =>
      h.post("/organization/update-member-role", headers, {
        memberId,
        role,
        organizationId: org.id,
      });
    expect((await update(b.headers, c.memberId, "admin")).status).toBe(403);
    expect((await update(b.headers, c.memberId, "helper")).status).toBe(200);
    expect((await update(b.headers, b.memberId, "member")).status).toBe(403);
    expect((await update(b.headers, d.memberId, "member")).status).toBe(403);
  });

  it("lets a built-in admin assign admin and refuses the owner changing their own role", async () => {
    const { owner, org, c, d } = await setup();
    const asAdmin = await h.post(
      "/organization/update-member-role",
      d.headers,
      {
        memberId: c.memberId,
        role: "admin",
        organizationId: org.id,
      }
    );
    expect(asAdmin.status).toBe(200);

    const ownerMember = await h.db.findOne<{ id: string }>({
      model: "member",
      where: [{ field: "role", value: "owner" }],
    });
    const own = await h.post(
      "/organization/update-member-role",
      owner.headers,
      {
        memberId: ownerMember?.id ?? "",
        role: "admin",
        organizationId: org.id,
      }
    );
    expect(own.status).toBe(403);
  });
});

describe("owner-only statements (real Better Auth)", () => {
  let h: AuthTestInstance;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-for-guards");
    h = await createAuthTestInstance();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function setup() {
    const owner = await h.signUp("owner@x.test");
    const org = await h.createOrg(owner.headers, "acme");
    const createRole = (permission: Record<string, string[]>, role: string) =>
      h.post("/organization/create-role", owner.headers, {
        role,
        permission,
        organizationId: org.id,
      });
    return { owner, org, createRole };
  }

  it("refuses statements outside the catalogue on create-role", async () => {
    const { createRole } = await setup();
    const bad: Record<string, string[]>[] = [
      { organization: ["delete"] },
      { member: ["create"] },
      { ac: ["create"] },
    ];
    for (const [index, permission] of bad.entries()) {
      const res = await createRole(permission, `bad-${index}`);
      expect(res.status).toBe(400);
      expect(res.code).toBe("PERMISSION_NOT_GRANTABLE");
    }
    expect((await createRole({ project: ["manage"] }, "projects")).status).toBe(
      200
    );
  });

  it("refuses organization:delete on update-role", async () => {
    const { owner, org, createRole } = await setup();
    await createRole({ project: ["manage"] }, "projects");
    const res = await h.post("/organization/update-role", owner.headers, {
      roleName: "projects",
      organizationId: org.id,
      data: { permission: { project: ["manage"], organization: ["delete"] } },
    });
    expect(res.status).toBe(400);
    expect(res.code).toBe("PERMISSION_NOT_GRANTABLE");
  });

  it("lets only the owner delete the organization", async () => {
    const { owner, org, createRole } = await setup();
    await createRole({ project: ["manage"] }, "projects");
    // Bypass the guard: write the owner-only statement straight into the row.
    await h.db.update({
      model: "organizationRole",
      where: [{ field: "role", value: "projects" }],
      update: { permission: JSON.stringify({ organization: ["delete"] }) },
    });
    const holder = await h.signUp("holder@x.test");
    await h.addMember(org.id, holder.userId, "projects");
    const admin = await h.signUp("admin@x.test");
    await h.addMember(org.id, admin.userId, "admin");

    const asHolder = await h.post("/organization/delete", holder.headers, {
      organizationId: org.id,
    });
    expect(asHolder.status).toBe(403);
    expect(asHolder.code).toBe("OWNER_ONLY");
    const asAdmin = await h.post("/organization/delete", admin.headers, {
      organizationId: org.id,
    });
    expect(asAdmin.status).toBe(403);
    const asOwner = await h.post("/organization/delete", owner.headers, {
      organizationId: org.id,
    });
    expect(asOwner.status).toBe(200);
  });
});
