import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, withDbMock } = vi.hoisted(() => {
  const fakeDb = {
    authInvitation: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    authMember: { create: vi.fn(), findFirst: vi.fn() },
    authOrganization: { findFirst: vi.fn(), create: vi.fn() },
    authSession: { updateMany: vi.fn() },
    authUser: { updateMany: vi.fn() },
  };
  const run = (fn: (client: typeof fakeDb) => unknown) => fn(fakeDb);
  return {
    db: fakeDb,
    withDbMock: Object.assign(vi.fn(run), { tx: vi.fn(run) }),
  };
});

vi.mock("@repo/database", () => ({ withDb: withDbMock }));
vi.mock("@repo/observability/log", () => ({ log: { info: vi.fn() } }));
vi.mock("@/app/organizations/service", () => ({ organizationsService: {} }));
vi.mock("@/app/users/service", () => ({ usersService: {} }));
vi.mock("@/lib/db-utils", () => ({
  getPrismaErrorCode: (error: { code?: string }) => error?.code,
}));

import { BuiltInOrgRole } from "@repo/api/src/types/org-permissions";
import { orgSlugSchema } from "@repo/api/src/types/reserved-slugs";
import {
  hasPendingInvitation,
  markEmailVerified,
  provisionNewUser,
} from "@/lib/auth/identity-provisioning";

const PERSONAL_SLUG = /^ada-[a-z0-9]{4}$/;
const USER = { id: "user-1", email: "Ada@Example.test", name: "Ada" };

describe("provisionNewUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    db.authInvitation.findMany.mockResolvedValue([]);
    db.authOrganization.findFirst.mockResolvedValue(null);
    db.authOrganization.create.mockResolvedValue({ id: "org-new" });
    db.authMember.findFirst.mockResolvedValue({ organizationId: "org-new" });
    db.authSession.updateMany.mockResolvedValue({ count: 1 });
  });

  it("creates the default organization with the first account as owner", async () => {
    await provisionNewUser(USER);

    expect(db.authOrganization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "AgentFlow",
          slug: "agentflow",
        }),
      })
    );
    expect(db.authMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-new",
        userId: "user-1",
        role: BuiltInOrgRole.Owner,
      }),
    });
  });

  it("names the first organization from the environment", async () => {
    vi.stubEnv("AUTH_DEFAULT_ORGANIZATION_NAME", "Acme");
    vi.stubEnv("AUTH_DEFAULT_ORGANIZATION_SLUG", "acme");

    await provisionNewUser(USER);

    expect(db.authOrganization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Acme", slug: "acme" }),
      })
    );
  });

  it("gives later accounts their own organization as owner", async () => {
    db.authOrganization.findFirst.mockResolvedValue({ id: "org-1" });

    await provisionNewUser(USER);

    const data = db.authOrganization.create.mock.calls[0]?.[0].data;
    expect(data.name).toBe("Ada's organization");
    expect(data.slug).toMatch(PERSONAL_SLUG);
    expect(orgSlugSchema.safeParse(data.slug).success).toBe(true);
    expect(db.authMember.create).toHaveBeenCalledTimes(1);
    expect(db.authMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-new",
        role: BuiltInOrgRole.Owner,
      }),
    });
    expect(db.authMember.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org-1" }),
    });
  });

  it("falls back to the email local part when the name is blank", async () => {
    db.authOrganization.findFirst.mockResolvedValue({ id: "org-1" });

    await provisionNewUser({
      ...USER,
      name: " ",
      email: "j.doe+x@example.test",
    });

    const data = db.authOrganization.create.mock.calls[0]?.[0].data;
    expect(data.name).toBe("j.doe+x's organization");
    expect(orgSlugSchema.safeParse(data.slug).success).toBe(true);
  });

  it("does not accept pending invitations or join the inviting organization", async () => {
    db.authOrganization.findFirst.mockResolvedValue({ id: "org-9" });

    await provisionNewUser(USER);

    expect(db.authInvitation.update).not.toHaveBeenCalled();
    expect(db.authMember.create).toHaveBeenCalledTimes(1);
    expect(db.authMember.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org-9" }),
    });
  });

  it("activates the new organization on sessions created before the hook ran", async () => {
    await provisionNewUser(USER);

    expect(db.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", activeOrganizationId: null },
      data: { activeOrganizationId: "org-new" },
    });
  });

  it("retries in a fresh transaction on a slug collision", async () => {
    db.authOrganization.findFirst.mockResolvedValue({ id: "org-1" });
    db.authOrganization.create
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce({ id: "org-retry" });

    await provisionNewUser(USER);

    expect(withDbMock.tx).toHaveBeenCalledTimes(2);
    expect(db.authOrganization.create).toHaveBeenCalledTimes(2);
    expect(db.authMember.create).toHaveBeenCalledTimes(1);
  });

  it("takes the personal branch when it loses the empty-install race", async () => {
    db.authOrganization.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "org-winner" });
    db.authOrganization.create.mockRejectedValueOnce({ code: "P2002" });

    await provisionNewUser(USER);

    const data = db.authOrganization.create.mock.calls[1]?.[0].data;
    expect(data.slug).not.toBe("agentflow");
    expect(db.authMember.create).toHaveBeenCalledTimes(1);
  });

  it("gives up after three collisions", async () => {
    db.authOrganization.create.mockRejectedValue({ code: "P2002" });

    await expect(provisionNewUser(USER)).rejects.toEqual({ code: "P2002" });
    expect(db.authOrganization.create).toHaveBeenCalledTimes(3);
  });
});

describe("markEmailVerified", () => {
  it("only updates unverified accounts", async () => {
    db.authUser.updateMany.mockResolvedValue({ count: 1 });
    await markEmailVerified("user-1");
    expect(db.authUser.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", emailVerified: false },
      data: { emailVerified: true },
    });
  });
});

describe("hasPendingInvitation", () => {
  it("looks up unexpired pending invitations case-insensitively", async () => {
    db.authInvitation.findFirst.mockResolvedValueOnce({ id: "inv-1" });
    await expect(hasPendingInvitation("New@Example.test")).resolves.toBe(true);
    expect(db.authInvitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: "new@example.test",
          status: "pending",
          expiresAt: { gt: expect.any(Date) },
        }),
      })
    );

    db.authInvitation.findFirst.mockResolvedValueOnce(null);
    await expect(hasPendingInvitation("other@example.test")).resolves.toBe(
      false
    );
  });
});
