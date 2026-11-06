import {
  AgentKind,
  AgentWorkflowRole,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentKind,
  agentProjectIds,
  compareClaudeCodeVersion,
  computeTargetFleetService,
  ownerName,
  reportedClaudeVersion,
  workflowRolesForTarget,
} from "@/app/compute-targets/fleet-service";

const mocks = vi.hoisted(() => ({
  targetFindMany: vi.fn(),
  capabilityFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  workflowFindMany: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      computeTarget: { findMany: mocks.targetFindMany },
      computeTargetCapabilities: { findMany: mocks.capabilityFindMany },
      project: { findMany: mocks.projectFindMany },
      workflow: { findMany: mocks.workflowFindMany },
    }),
}));

const T1 = "target-1";

describe("agentKind", () => {
  it("detects a personal agent", () => {
    expect(agentKind({ personalRunner: {} })).toBe(AgentKind.Personal);
    expect(agentKind({ versions: {} })).toBe(AgentKind.Automatic);
    expect(agentKind(null)).toBe(AgentKind.Automatic);
  });
});

describe("reportedClaudeVersion", () => {
  it("extracts the semantic version", () => {
    expect(
      reportedClaudeVersion({ versions: { claude: "2.1.296 (Claude Code)" } })
    ).toBe("2.1.296");
  });

  it("is null without a reported version", () => {
    expect(reportedClaudeVersion({ versions: {} })).toBeNull();
    expect(reportedClaudeVersion({ versions: { claude: "n/a" } })).toBeNull();
    expect(reportedClaudeVersion(null)).toBeNull();
  });
});

describe("compareClaudeCodeVersion", () => {
  it("returns each status", () => {
    expect(compareClaudeCodeVersion("2.1.0", "latest")).toBe(
      ClaudeCodeVersionStatus.Latest
    );
    expect(compareClaudeCodeVersion(null, "2.1.0")).toBe(
      ClaudeCodeVersionStatus.Unknown
    );
    expect(compareClaudeCodeVersion("2.1.0", "2.1.0")).toBe(
      ClaudeCodeVersionStatus.Match
    );
    expect(compareClaudeCodeVersion("2.0.0", "2.1.0")).toBe(
      ClaudeCodeVersionStatus.Mismatch
    );
  });
});

describe("ownerName", () => {
  it("joins and trims", () => {
    expect(ownerName({ firstName: "Ada", lastName: "Lovelace" })).toBe(
      "Ada Lovelace"
    );
    expect(ownerName({ firstName: "Ada", lastName: null })).toBe("Ada");
    expect(ownerName({ firstName: null, lastName: " " })).toBeNull();
    expect(ownerName(null)).toBeNull();
  });
});

describe("agentProjectIds", () => {
  const projects = [
    { id: "p1", settings: { runnerIds: [T1] } },
    { id: "p2", settings: {} },
    { id: "p3", settings: { runnerIds: [T1] } },
  ];

  it("counts only the projects that list the Agent", () => {
    const ids = agentProjectIds(T1, projects);

    expect([...ids].sort()).toEqual(["p1", "p3"]);
  });
});

describe("workflowRolesForTarget", () => {
  const roles = (agentConfig: unknown, projects: string[] = []) =>
    workflowRolesForTarget(
      T1,
      { agentConfig, projectId: "p1" },
      new Set(projects)
    );

  it("maps each role", () => {
    expect(
      roles({ mode: WorkflowAgentMode.Orchestrated, computeTargetId: T1 })
    ).toEqual([AgentWorkflowRole.Orchestrator]);
    expect(
      roles({ mode: WorkflowAgentMode.Plan, computeTargetId: T1 })
    ).toEqual([AgentWorkflowRole.Default]);
    expect(roles({ runners: [{ computeTargetId: T1 }] })).toEqual([
      AgentWorkflowRole.Rule,
    ]);
    expect(roles({ mode: WorkflowAgentMode.Orchestrated }, ["p1"])).toEqual([
      AgentWorkflowRole.ProjectAgent,
    ]);
    expect(roles({ mode: WorkflowAgentMode.Plan }, ["p1"])).toEqual([]);
    expect(roles(null)).toEqual([]);
  });

  it("lists several roles in order", () => {
    expect(
      roles(
        {
          mode: WorkflowAgentMode.Orchestrated,
          computeTargetId: T1,
          runners: [{ computeTargetId: T1 }],
        },
        ["p1"]
      )
    ).toEqual([
      AgentWorkflowRole.Orchestrator,
      AgentWorkflowRole.Rule,
      AgentWorkflowRole.ProjectAgent,
    ]);
  });
});

describe("computeTargetFleetService.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.targetFindMany.mockResolvedValue([
      {
        id: T1,
        machineName: "runner-1",
        isOnline: true,
        isSharedWithOrg: false,
        lastSeenAt: new Date("2026-10-30T10:00:00.000Z"),
        capabilities: {
          personalRunner: {},
          versions: { claude: "2.1.296 (Claude Code)" },
        },
        modelProvider: null,
        user: { firstName: "Ada", lastName: null },
        healthCheck: {
          checkedAt: new Date("2026-10-30T09:00:00.000Z"),
          allRequiredPassed: false,
          requiredFailureIds: ["git", "gh"],
        },
      },
    ]);
    mocks.capabilityFindMany.mockResolvedValue([
      {
        computeTargetId: T1,
        projectId: "p1",
        capabilities: { runner: "Dev", commands: [{ name: "analyze" }] },
        problems: [{ message: "x" }],
      },
      {
        computeTargetId: T1,
        projectId: "p2",
        capabilities: { runner: "Dev", commands: [{ name: "other" }] },
        problems: [],
      },
    ]);
    mocks.projectFindMany.mockResolvedValue([
      { id: "p1", name: "Proj", settings: { runnerIds: [T1] } },
      { id: "p2", name: "Other", settings: {} },
    ]);
    mocks.workflowFindMany.mockResolvedValue([
      {
        id: "w1",
        name: "W",
        projectId: "p1",
        agentConfig: { mode: WorkflowAgentMode.Orchestrated },
      },
      { id: "w2", name: "W2", projectId: "p2", agentConfig: {} },
    ]);
  });

  it("lists every target of the organization, personal ones included", async () => {
    const { agents } = await computeTargetFleetService.list("org");

    expect(mocks.targetFindMany.mock.calls[0]?.[0].where).toEqual({
      organizationId: "org",
      isCloudSentinel: false,
    });
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: T1,
      kind: AgentKind.Personal,
      displayName: "Dev",
      ownerName: "Ada",
      lastSeen: "2026-10-30T10:00:00.000Z",
      enabledWorkflowCount: 1,
      health: {
        healthChecked: "2026-10-30T09:00:00.000Z",
        allRequiredPassed: false,
        requiredFailureCount: 2,
      },
      claudeCode: {
        reported: "2.1.296",
        pinned: "latest",
        status: ClaudeCodeVersionStatus.Latest,
      },
      projects: [
        { id: "p1", name: "Proj", commands: ["analyze"], problemCount: 1 },
      ],
    });
  });

  it("makes no further query without targets", async () => {
    mocks.targetFindMany.mockResolvedValue([]);

    const result = await computeTargetFleetService.list("org");

    expect(result.agents).toEqual([]);
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
  });
});
