import { AgentKind } from "@repo/api/src/types/agent-fleet";
import { LoopStatus } from "@repo/api/src/types/loop";
import {
  readPersonalAgentProjectKey,
  readProjectRunnerIds,
} from "@repo/api/src/types/project-runners";
import { Status } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseProjectRunner,
  ProjectRunnerChoiceKind,
} from "@/app/projects/project-runner-selection";
import { projectRunnersService } from "@/app/projects/project-runners-service";

const ORG_ID = "0199a5f0-0000-7000-8000-00000000000a";
const USER_ID = "0199a5f0-0000-7000-8000-00000000000b";
const PROJECT_ID = "0199a5f0-0000-7000-8000-0000000000d1";
const DOCUMENT_ID = "0199a5f0-0000-7000-8000-0000000000e1";
const DOTNET = "0199a5f0-0000-7000-8000-0000000000c1";
const NODE = "0199a5f0-0000-7000-8000-0000000000c2";
const BIG = "0199a5f0-0000-7000-8000-0000000000c3";

type Target = {
  id: string;
  machineName: string;
  userId: string;
  isOnline: boolean;
  isSharedWithOrg: boolean;
  lastSeenAt: Date;
  capabilities: unknown;
  user: { firstName: string; lastName: string } | null;
};

type Where = {
  id: { in?: string[]; notIn?: string[] };
  isOnline?: boolean;
  capabilities?: { path: string[]; equals: string };
  OR?: Array<{ userId?: string; isSharedWithOrg?: boolean }>;
};

const mocks = vi.hoisted(() => ({
  settings: null as unknown,
  slug: null as string | null,
  targets: [] as Target[],
  /** computeTargetId → loops waiting or running. */
  active: {} as Record<string, number>,
  loopWhere: null as unknown,
  projectWhere: null as unknown,
  artifactReads: 0,
  executeRaw: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      artifact: {
        findFirst: () => {
          mocks.artifactReads += 1;
          return Promise.resolve({
            project: { name: "Payments", settings: mocks.settings },
          });
        },
      },
      project: {
        findFirst: ({ where }: { where: unknown }) => {
          mocks.projectWhere = where;
          return Promise.resolve({
            name: "Payments",
            settings: mocks.settings,
            slug: mocks.slug,
          });
        },
      },
      computeTarget: {
        findFirst: ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            mocks.targets.find((target) => target.id === where.id) ?? null
          ),
        findMany: ({ where }: { where: Where }) =>
          Promise.resolve(
            mocks.targets.filter(
              (target) =>
                (!where.id.in || where.id.in.includes(target.id)) &&
                !where.id.notIn?.includes(target.id) &&
                (where.isOnline === undefined ||
                  target.isOnline === where.isOnline) &&
                (!where.capabilities ||
                  personalKey(target.capabilities) ===
                    where.capabilities.equals) &&
                (!where.OR ||
                  where.OR.some(
                    (option) =>
                      option.userId === target.userId ||
                      option.isSharedWithOrg === target.isSharedWithOrg
                  ))
            )
          ),
      },
      loop: {
        groupBy: (args: { where: unknown }) => {
          mocks.loopWhere = args.where;
          return Promise.resolve(
            Object.entries(mocks.active).map(([computeTargetId, count]) => ({
              computeTargetId,
              _count: { _all: count },
            }))
          );
        },
      },
      $executeRaw: mocks.executeRaw,
    }),
}));

function personalKey(capabilities: unknown): string | null {
  return readPersonalAgentProjectKey(capabilities);
}

function personal(id: string, key: string, overrides: Partial<Target> = {}) {
  return target(id, {
    capabilities: { personalRunner: { projectKey: key } },
    ...overrides,
  });
}

function target(id: string, overrides: Partial<Target> = {}): Target {
  return {
    id,
    machineName: `runner-${id.slice(-2)}`,
    userId: "someone-else",
    isOnline: true,
    isSharedWithOrg: true,
    lastSeenAt: new Date("2026-10-06T10:00:00.000Z"),
    capabilities: { maxInFlightCommands: 2 },
    user: { firstName: "Ops", lastName: "Team" },
    ...overrides,
  };
}

function choose(preferredComputeTargetId?: string) {
  return chooseProjectRunner({
    organizationId: ORG_ID,
    userId: USER_ID,
    documentId: DOCUMENT_ID,
    preferredComputeTargetId,
  });
}

beforeEach(() => {
  mocks.settings = { runnerIds: [DOTNET, NODE, BIG] };
  mocks.slug = null;
  mocks.targets = [target(DOTNET), target(NODE), target(BIG)];
  mocks.active = {};
  mocks.loopWhere = null;
  mocks.projectWhere = null;
  mocks.artifactReads = 0;
  mocks.executeRaw.mockReset();
  mocks.executeRaw.mockResolvedValue(1);
});

describe("readProjectRunnerIds", () => {
  it("reads runnerIds and is empty otherwise", () => {
    expect(readProjectRunnerIds({ runnerIds: [DOTNET] })).toEqual([DOTNET]);
    expect(readProjectRunnerIds({ agentInstructions: "x" })).toEqual([]);
    expect(readProjectRunnerIds(null)).toEqual([]);
  });
});

describe("chooseProjectRunner", () => {
  it("leaves the choice to the caller on a project without runners", async () => {
    mocks.settings = {};

    expect(await choose(DOTNET)).toEqual({
      kind: ProjectRunnerChoiceKind.None,
    });
  });

  it("keeps the requested computer when it is one of the runners", async () => {
    mocks.active = { [NODE]: 2 };

    expect(await choose(NODE)).toEqual({
      kind: ProjectRunnerChoiceKind.Resolved,
      computeTargetId: NODE,
    });
  });

  it("picks the runner with the most free capacity otherwise", async () => {
    mocks.targets = [
      target(DOTNET),
      target(NODE),
      target(BIG, { capabilities: { maxInFlightCommands: 8 } }),
    ];
    mocks.active = { [DOTNET]: 1, [BIG]: 3 };

    // NODE is idle: 0/2 beats BIG at 3/8 and DOTNET at 1/2.
    expect(await choose("not-a-runner")).toEqual({
      kind: ProjectRunnerChoiceKind.Resolved,
      computeTargetId: NODE,
    });
    expect(mocks.loopWhere).toMatchObject({
      organizationId: ORG_ID,
      status: {
        in: [LoopStatus.Pending, LoopStatus.Claimed, LoopStatus.Running],
      },
    });

    mocks.active = { [DOTNET]: 1, [NODE]: 1, [BIG]: 3 };
    // BIG at 3/8 now beats 1/2 on the others.
    expect(await choose()).toMatchObject({ computeTargetId: BIG });
  });

  it("prefers the most recently seen runner among equally busy ones", async () => {
    mocks.targets = [
      target(DOTNET),
      target(NODE, { lastSeenAt: new Date("2026-10-06T10:05:00.000Z") }),
    ];

    expect(await choose()).toMatchObject({ computeTargetId: NODE });
  });

  it("reads the project's own runners before the run has documents", async () => {
    const choice = await chooseProjectRunner({
      organizationId: ORG_ID,
      userId: USER_ID,
      projectId: PROJECT_ID,
      preferredComputeTargetId: NODE,
    });

    expect(choice).toEqual({
      kind: ProjectRunnerChoiceKind.Resolved,
      computeTargetId: NODE,
    });
    expect(mocks.projectWhere).toEqual({
      id: PROJECT_ID,
      organizationId: ORG_ID,
    });
    expect(mocks.artifactReads).toBe(0);
  });

  it("refuses a named Agent outside the project's Agents, even with none online", async () => {
    const outsider = "0199a5f0-0000-7000-8000-0000000000c9";
    mocks.targets = [target(outsider), target(DOTNET, { isOnline: false })];

    const choice = await chooseProjectRunner({
      organizationId: ORG_ID,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      preferredComputeTargetId: outsider,
      requirePreferred: true,
    });

    expect(choice.kind).toBe(ProjectRunnerChoiceKind.NotProjectAgent);
    expect(choice).toMatchObject({
      message: expect.stringContaining("runner-c9"),
    });
    expect(choice).toMatchObject({
      message: expect.stringContaining("Payments"),
    });
  });

  it("swaps to the least-busy Agent without requirePreferred", async () => {
    const outsider = "0199a5f0-0000-7000-8000-0000000000c9";
    mocks.targets = [target(outsider), target(NODE)];

    expect(await choose(outsider)).toMatchObject({ computeTargetId: NODE });
  });

  it("fails when a required personal project Agent is offline", async () => {
    mocks.targets = [
      personal(DOTNET, "PRO-1", { isOnline: false }),
      target(NODE),
    ];

    const choice = await chooseProjectRunner({
      organizationId: ORG_ID,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      preferredComputeTargetId: DOTNET,
      requirePreferred: true,
    });

    expect(choice.kind).toBe(ProjectRunnerChoiceKind.Unavailable);
    expect(choice).toMatchObject({
      message: expect.stringContaining("Personal Agent"),
    });
  });

  it("gives way to the least-busy Agent when a required automatic one is offline", async () => {
    mocks.targets = [target(DOTNET, { isOnline: false }), target(NODE)];

    const choice = await chooseProjectRunner({
      organizationId: ORG_ID,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      preferredComputeTargetId: DOTNET,
      requirePreferred: true,
    });

    expect(choice).toMatchObject({ computeTargetId: NODE });
  });

  it("never moves a step to a personal Agent that is not the preferred one", async () => {
    mocks.targets = [
      target(DOTNET, { isOnline: false }),
      personal(NODE, "PRO-1"),
    ];

    const choice = await choose(DOTNET);

    expect(choice.kind).toBe(ProjectRunnerChoiceKind.Unavailable);
  });

  it("picks the shared Agent over a less busy personal one", async () => {
    mocks.targets = [target(DOTNET), personal(NODE, "PRO-1")];

    expect(await choose(BIG)).toMatchObject({ computeTargetId: DOTNET });
  });

  it("keeps a personal Agent when it is the preferred one", async () => {
    mocks.targets = [target(DOTNET), personal(NODE, "PRO-1")];

    expect(await choose(NODE)).toMatchObject({ computeTargetId: NODE });
  });

  it("never falls back to another computer when no runner can take the loop", async () => {
    mocks.targets = [
      target(DOTNET, { isOnline: false }),
      target(NODE, { isSharedWithOrg: false }),
    ];

    const choice = await choose(BIG);

    expect(choice.kind).toBe(ProjectRunnerChoiceKind.Unavailable);
  });
});

describe("projectRunnersService", () => {
  it("lists the runners in order with their load and tools", async () => {
    mocks.settings = { runnerIds: [NODE, "deleted-runner", DOTNET] };
    mocks.targets = [
      target(DOTNET, {
        isOnline: false,
        capabilities: {
          versions: { git: "git version 2.39.5" },
          toolchains: { dotnet: "8.0.404" },
        },
        user: null,
      }),
      target(NODE),
    ];
    mocks.active = { [NODE]: 1 };

    expect(await projectRunnersService.get(ORG_ID, PROJECT_ID)).toEqual({
      projectKey: null,
      waiting: [],
      runners: [
        {
          id: NODE,
          machineName: "runner-c2",
          isOnline: true,
          isSharedWithOrg: true,
          kind: AgentKind.Automatic,
          ownerName: "Ops Team",
          capacity: 2,
          activeLoops: 1,
          tools: {},
        },
        {
          id: DOTNET,
          machineName: "runner-c1",
          isOnline: false,
          isSharedWithOrg: true,
          kind: AgentKind.Automatic,
          ownerName: null,
          capacity: null,
          activeLoops: 0,
          tools: { git: "git version 2.39.5", dotnet: "8.0.404" },
        },
      ],
    });
  });

  it("stores the runners with a single jsonb update", async () => {
    const result = await projectRunnersService.update(
      ORG_ID,
      USER_ID,
      PROJECT_ID,
      { runnerIds: [NODE, DOTNET, NODE] }
    );

    expect(result.ok).toBe(true);
    const [strings, ...values] = mocks.executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(strings.join("?")).toContain("'{runnerIds}'");
    expect(values[0]).toBe(JSON.stringify([NODE, DOTNET]));
  });

  it("refuses a computer the caller cannot dispatch to", async () => {
    mocks.targets = [target(DOTNET, { isSharedWithOrg: false })];

    const result = await projectRunnersService.update(
      ORG_ID,
      USER_ID,
      PROJECT_ID,
      { runnerIds: [DOTNET] }
    );

    expect(result).toMatchObject({
      ok: false,
      error: { status: Status.BadRequest },
    });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("adds a personal Agent only to its own project", async () => {
    mocks.slug = "PRO-1";
    mocks.settings = {};
    mocks.targets = [personal(DOTNET, "PRO-1")];

    const ok = await projectRunnersService.update(ORG_ID, USER_ID, PROJECT_ID, {
      runnerIds: [DOTNET],
    });
    expect(ok.ok).toBe(true);

    mocks.slug = "PRO-2";
    const refused = await projectRunnersService.update(
      ORG_ID,
      USER_ID,
      PROJECT_ID,
      { runnerIds: [DOTNET] }
    );
    expect(refused).toMatchObject({
      ok: false,
      error: {
        status: Status.BadRequest,
        message: expect.stringContaining(
          "personal Agent of project PRO-1: it can only be added to that project"
        ),
      },
    });
  });

  it("does not let a stored mismatched personal Agent block a removal", async () => {
    mocks.slug = "PRO-2";
    mocks.settings = { runnerIds: [DOTNET, NODE] };
    mocks.targets = [personal(DOTNET, "PRO-1"), target(NODE)];

    const result = await projectRunnersService.update(
      ORG_ID,
      USER_ID,
      PROJECT_ID,
      { runnerIds: [DOTNET] }
    );

    expect(result.ok).toBe(true);
  });

  it("explains that a private Agent of another user must be shared", async () => {
    mocks.targets = [target(DOTNET, { isSharedWithOrg: false })];

    const result = await projectRunnersService.update(
      ORG_ID,
      USER_ID,
      PROJECT_ID,
      { runnerIds: [DOTNET] }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("is not shared with the organization"),
      },
    });
  });

  it("lists the unadded personal Agents of this project as waiting", async () => {
    mocks.slug = "PRO-1";
    mocks.settings = { runnerIds: [DOTNET] };
    mocks.targets = [
      target(DOTNET),
      personal(NODE, "PRO-1"),
      personal(BIG, "PRO-2"),
    ];

    const result = await projectRunnersService.get(ORG_ID, PROJECT_ID);

    expect(result?.projectKey).toBe("PRO-1");
    expect(result?.runners.map((r) => r.id)).toEqual([DOTNET]);
    expect(result?.waiting.map((r) => [r.id, r.kind])).toEqual([
      [NODE, AgentKind.Personal],
    ]);
  });

  it("reports a missing project", async () => {
    mocks.executeRaw.mockResolvedValue(0);

    const result = await projectRunnersService.update(
      ORG_ID,
      USER_ID,
      PROJECT_ID,
      { runnerIds: [] }
    );

    expect(result).toMatchObject({
      ok: false,
      error: { status: Status.NotFound },
    });
  });
});
