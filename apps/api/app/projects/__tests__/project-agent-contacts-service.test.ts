import { ProjectAgentContactKind } from "@repo/api/src/types/project-runners";
import { Status } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectAgentContactsService } from "../project-agent-contacts-service";

const ORG_ID = "0199a5f0-0000-7000-8000-00000000000a";
const PROJECT_ID = "0199a5f0-0000-7000-8000-0000000000d1";
const TARGET = "0199a5f0-0000-7000-8000-0000000000c1";
const AGENT_ID = "0199a5f0-0000-7000-8000-0000000000f1";
const ADA = "0199a5f0-0000-7000-8000-0000000000b1";
const BOB = "0199a5f0-0000-7000-8000-0000000000b2";

type Contact = {
  id: string;
  userId: string | null;
  email: string | null;
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    active: boolean;
    organizationId: string;
  } | null;
};

const mocks = vi.hoisted(() => ({
  agent: null as { id: string; contacts: unknown[] } | null,
  activeUsers: [] as string[],
  agentFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  contactDeleteMany: vi.fn(),
  contactCreateMany: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const db = () => ({
    projectAgent: {
      findFirst: mocks.agentFindFirst,
      findMany: () =>
        Promise.resolve(
          mocks.agent
            ? [{ computeTargetId: TARGET, contacts: mocks.agent.contacts }]
            : []
        ),
    },
    user: { findMany: mocks.userFindMany },
    projectAgentContact: {
      deleteMany: mocks.contactDeleteMany,
      createMany: mocks.contactCreateMany,
    },
  });
  return {
    withDb: Object.assign((fn: (d: unknown) => unknown) => fn(db()), {
      tx: (fn: (d: unknown) => unknown) => fn(db()),
    }),
  };
});

function member(
  id: string,
  email: string,
  overrides: Partial<NonNullable<Contact["user"]>> = {}
): Contact {
  return {
    id: `c-${id}`,
    userId: id,
    email: null,
    user: {
      email,
      firstName: "Ada",
      lastName: "Lovelace",
      active: true,
      organizationId: ORG_ID,
      ...overrides,
    },
  };
}

function external(email: string): Contact {
  return { id: `c-${email}`, userId: null, email, user: null };
}

beforeEach(() => {
  mocks.agent = { id: AGENT_ID, contacts: [] };
  mocks.activeUsers = [ADA, BOB];
  mocks.agentFindFirst.mockReset();
  mocks.agentFindFirst.mockImplementation(() => Promise.resolve(mocks.agent));
  mocks.userFindMany.mockReset();
  mocks.userFindMany.mockImplementation(
    ({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        where.id.in
          .filter((id) => mocks.activeUsers.includes(id))
          .map((id) => ({ id }))
      )
  );
  mocks.contactDeleteMany.mockReset();
  mocks.contactDeleteMany.mockResolvedValue({ count: 2 });
  mocks.contactCreateMany.mockReset();
  mocks.contactCreateMany.mockResolvedValue({ count: 0 });
});

describe("projectAgentContactsService.replace", () => {
  it("replaces the contacts in input order, dropping duplicates", async () => {
    const result = await projectAgentContactsService.replace(
      ORG_ID,
      PROJECT_ID,
      TARGET,
      {
        contacts: [
          { userId: ADA },
          { email: "ops@acme.dev" },
          { userId: ADA },
          { email: "ops@acme.dev" },
        ],
      }
    );

    expect(result.ok).toBe(true);
    expect(mocks.contactDeleteMany).toHaveBeenCalledWith({
      where: { projectAgentId: AGENT_ID },
    });
    expect(mocks.contactCreateMany).toHaveBeenCalledWith({
      data: [
        { projectAgentId: AGENT_ID, userId: ADA, email: null },
        { projectAgentId: AGENT_ID, userId: null, email: "ops@acme.dev" },
      ],
    });
  });

  it("refuses an Agent that is not one of the project's", async () => {
    mocks.agent = null;

    const result = await projectAgentContactsService.replace(
      ORG_ID,
      PROJECT_ID,
      TARGET,
      { contacts: [] }
    );

    expect(result).toMatchObject({
      ok: false,
      error: { status: Status.NotFound },
    });
    expect(mocks.contactDeleteMany).not.toHaveBeenCalled();
  });

  it("refuses a user that is not an active member of the organization", async () => {
    mocks.activeUsers = [ADA];

    const result = await projectAgentContactsService.replace(
      ORG_ID,
      PROJECT_ID,
      TARGET,
      { contacts: [{ userId: ADA }, { userId: BOB }] }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        status: Status.BadRequest,
        message: "Choose members of this organization",
      },
    });
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          active: true,
        }),
      })
    );
    expect(mocks.contactDeleteMany).not.toHaveBeenCalled();
  });

  it("answers not found when the Agent is removed during the save", async () => {
    mocks.contactCreateMany.mockRejectedValue({ code: "P2003" });

    const result = await projectAgentContactsService.replace(
      ORG_ID,
      PROJECT_ID,
      TARGET,
      { contacts: [{ userId: ADA }] }
    );

    expect(result).toMatchObject({
      ok: false,
      error: { status: Status.NotFound },
    });
  });

  it("clears the contacts with an empty list", async () => {
    const result = await projectAgentContactsService.replace(
      ORG_ID,
      PROJECT_ID,
      TARGET,
      { contacts: [] }
    );

    expect(result.ok).toBe(true);
    expect(mocks.contactDeleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.contactCreateMany).not.toHaveBeenCalled();
  });
});

describe("projectAgentContactsService.listByProject", () => {
  it("maps members and external addresses, leaving out inactive members", async () => {
    mocks.agent = {
      id: AGENT_ID,
      contacts: [
        member(ADA, "ada@acme.dev"),
        member(BOB, "bob@acme.dev", { active: false }),
        external("ops@acme.dev"),
      ],
    };

    const contacts = await projectAgentContactsService.listByProject(
      ORG_ID,
      PROJECT_ID
    );

    expect(contacts.get(TARGET)).toEqual([
      {
        id: `c-${ADA}`,
        kind: ProjectAgentContactKind.Member,
        userId: ADA,
        email: "ada@acme.dev",
        name: "Ada Lovelace",
      },
      {
        id: "c-ops@acme.dev",
        kind: ProjectAgentContactKind.External,
        userId: null,
        email: "ops@acme.dev",
        name: null,
      },
    ]);
  });
});

describe("projectAgentContactsService.recipientEmails", () => {
  it("mixes members and external emails, drops inactive ones and duplicates", async () => {
    mocks.agent = {
      id: AGENT_ID,
      contacts: [
        member(ADA, "Ada@Acme.dev"),
        member(BOB, "bob@acme.dev", { active: false }),
        external("ada@acme.dev"),
        external("ops@acme.dev"),
      ],
    };

    expect(
      await projectAgentContactsService.recipientEmails(
        ORG_ID,
        PROJECT_ID,
        TARGET
      )
    ).toEqual(["ada@acme.dev", "ops@acme.dev"]);
  });

  it("is empty when the Agent is not in the project", async () => {
    mocks.agent = null;

    expect(
      await projectAgentContactsService.recipientEmails(
        ORG_ID,
        PROJECT_ID,
        TARGET
      )
    ).toEqual([]);
  });
});

describe("projectAgentContactsService.removeMember", () => {
  it("removes the member's contacts within the organization", async () => {
    mocks.contactDeleteMany.mockResolvedValue({ count: 3 });

    expect(await projectAgentContactsService.removeMember(ORG_ID, ADA)).toBe(3);
    expect(mocks.contactDeleteMany).toHaveBeenCalledWith({
      where: { userId: ADA, projectAgent: { organizationId: ORG_ID } },
    });
  });
});
