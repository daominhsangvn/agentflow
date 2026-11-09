import { Status } from "@repo/api/src/types/result";
import {
  RunnerCapabilitiesSource,
  RunnerCommandMode,
} from "@repo/api/src/types/runner-capabilities";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeTargetCapabilitiesService } from "@/app/compute-targets/capabilities-service";

const IDS = {
  org: "0199a5f0-0000-7000-8000-00000000000a",
  owner: "0199a5f0-0000-7000-8000-0000000000a1",
  other: "0199a5f0-0000-7000-8000-0000000000a2",
  target: "0199a5f0-0000-7000-8000-0000000000c1",
  project: "0199a5f0-0000-7000-8000-0000000000d1",
};

const FILE =
  "---\ncommands:\n  - { name: /plan-ticket, mode: write }\n---\n# Dev\n";

type Row = Record<string, unknown>;

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

const mocks = vi.hoisted(() => ({
  targetOwner: "" as string,
  projectSlug: "PRO-1",
  rows: [] as Row[],
  runnerIds: [] as string[],
  loadProjectRunnerIds: vi.fn(),
  capabilitiesWhere: null as unknown,
}));

vi.mock("@/lib/identifier-utils", () => ({
  resolveProjectId: (id: string) =>
    Promise.resolve(id === mocks.projectSlug ? IDS.project : null),
}));

vi.mock("@/app/projects/project-runner-selection", () => ({
  loadProjectRunnerIds: mocks.loadProjectRunnerIds,
}));

vi.mock("@repo/database", () => {
  const db = {
    project: {
      findFirst: vi.fn((args: { where: { id: string } }) =>
        Promise.resolve(
          args.where.id === IDS.project ? { id: IDS.project } : null
        )
      ),
    },
    computeTarget: {
      findFirst: vi.fn(
        (args: { where: { id: string; userId?: string; OR?: unknown } }) =>
          Promise.resolve(
            args.where.id === IDS.target &&
              (args.where.userId === undefined ||
                args.where.userId === mocks.targetOwner)
              ? { id: IDS.target }
              : null
          )
      ),
    },
    computeTargetCapabilities: {
      upsert: vi.fn((args: { create: Row; update: Row; where: unknown }) => {
        const existing = mocks.rows[0];
        const row = existing
          ? Object.assign(existing, args.update)
          : {
              id: "cap-1",
              computeTarget: { machineName: "an-PRO-1", isOnline: true },
              ...args.create,
            };
        mocks.rows = [row];
        return Promise.resolve(row);
      }),
      findMany: vi.fn(
        (args: { where: { computeTargetId?: { in: string[] } } }) => {
          mocks.capabilitiesWhere = args.where;
          const ids = args.where.computeTargetId?.in;
          return Promise.resolve(
            ids
              ? mocks.rows.filter((row) =>
                  ids.includes(row.computeTargetId as string)
                )
              : mocks.rows
          );
        }
      ),
    },
  };
  const withDb = (fn: (client: unknown) => unknown) => fn(db);
  withDb.tx = (fn: (client: unknown) => unknown) => fn(db);
  return { withDb, Prisma: { DbNull: null } };
});

beforeEach(() => {
  mocks.targetOwner = IDS.owner;
  mocks.rows = [];
  mocks.runnerIds = [];
  mocks.loadProjectRunnerIds.mockImplementation(() =>
    Promise.resolve(mocks.runnerIds)
  );
});

describe("computeTargetCapabilitiesService.listForProject", () => {
  const other = "0199a5f0-0000-7000-8000-0000000000ff";
  const fileRows = () =>
    [
      {
        id: "a",
        source: RunnerCapabilitiesSource.Personal,
        uploadedAt: new Date("2026-11-01T00:00:00.000Z"),
        computeTargetId: IDS.target,
        computeTarget: { machineName: "a", isOnline: true },
      },
      {
        id: "b",
        source: RunnerCapabilitiesSource.Personal,
        uploadedAt: new Date("2026-11-01T00:00:00.000Z"),
        computeTargetId: other,
        computeTarget: { machineName: "b", isOnline: true },
      },
    ] as Row[];

  it("returns only the project's Agents' files", async () => {
    mocks.rows = fileRows();
    mocks.runnerIds = [IDS.target];

    const files = await computeTargetCapabilitiesService.listForProject(
      IDS.org,
      IDS.project
    );

    expect(files.map((file) => file.computeTargetId)).toEqual([IDS.target]);
    expect(mocks.capabilitiesWhere).toMatchObject({ organizationId: IDS.org });
  });

  it("returns every file when the project has no Agents", async () => {
    mocks.rows = fileRows();

    const files = await computeTargetCapabilitiesService.listForProject(
      IDS.org,
      IDS.project
    );

    expect(files).toHaveLength(2);
  });
});

describe("computeTargetCapabilitiesService.upload", () => {
  it("stores the file with what the API parsed and the runner's warnings", async () => {
    const result = await computeTargetCapabilitiesService.upload(
      IDS.org,
      IDS.owner,
      IDS.target,
      {
        project: "PRO-1",
        source: RunnerCapabilitiesSource.Personal,
        content: FILE,
        warnings: ["/plan-ticket: not found in .claude/commands"],
      }
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toMatchObject({
      computeTargetId: IDS.target,
      runnerName: "an-PRO-1",
      isOnline: true,
      projectId: IDS.project,
      source: RunnerCapabilitiesSource.Personal,
      capabilities: {
        runner: null,
        toolkit: null,
        commands: [{ name: "/plan-ticket", mode: RunnerCommandMode.Write }],
        skills: [],
      },
      problems: [],
      warnings: ["/plan-ticket: not found in .claude/commands"],
    });
    expect(result.ok && result.value.contentHash).toMatch(SHA256_HEX_RE);
  });

  it("puts the API's secret warning before the runner's", async () => {
    const result = await computeTargetCapabilitiesService.upload(
      IDS.org,
      IDS.owner,
      IDS.target,
      {
        project: "PRO-1",
        source: RunnerCapabilitiesSource.Personal,
        content: `${FILE}password: hunter2hunter2x\n`,
        warnings: ["runner warning"],
      }
    );
    const warnings = result.ok ? result.value.warnings : [];
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("looks like it holds a secret");
    expect(warnings[1]).toBe("runner warning");
  });

  it("keeps a file whose front matter does not parse, with the problems", async () => {
    const result = await computeTargetCapabilitiesService.upload(
      IDS.org,
      IDS.owner,
      IDS.target,
      {
        project: "PRO-1",
        source: RunnerCapabilitiesSource.Personal,
        content: "# no front matter",
        warnings: [],
      }
    );
    expect(result.ok && result.value.capabilities).toBeNull();
    expect(result.ok && result.value.problems).toHaveLength(1);
  });

  it("refuses a runner the caller does not own", async () => {
    mocks.targetOwner = IDS.other;
    const result = await computeTargetCapabilitiesService.upload(
      IDS.org,
      IDS.owner,
      IDS.target,
      {
        project: "PRO-1",
        source: RunnerCapabilitiesSource.Personal,
        content: FILE,
        warnings: [],
      }
    );
    expect(result).toEqual({ ok: false, error: Status.NotFound });
    expect(mocks.rows).toEqual([]);
  });

  it("refuses a project the organization does not have", async () => {
    const result = await computeTargetCapabilitiesService.upload(
      IDS.org,
      IDS.owner,
      IDS.target,
      {
        project: "PRO-404",
        source: RunnerCapabilitiesSource.Personal,
        content: FILE,
        warnings: [],
      }
    );
    expect(result).toEqual({ ok: false, error: Status.NotFound });
  });
});

describe("computeTargetCapabilitiesService.listForTarget", () => {
  it("is null for a runner the caller cannot see", async () => {
    const files = await computeTargetCapabilitiesService.listForTarget(
      IDS.org,
      IDS.owner,
      "0199a5f0-0000-7000-8000-0000000000ff"
    );
    expect(files).toBeNull();
  });
});
