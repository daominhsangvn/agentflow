import { AgentKind } from "@repo/api/src/types/agent-fleet";
import { RunnerCapabilitiesSource } from "@repo/api/src/types/runner-capabilities";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadWorkflowAgentMap } from "@/app/orchestrator/cases/service/agent-map";

const ORG = "org-1";
const WF = "wf-1";
const PROJECT = "project-1";

const mocks = vi.hoisted(() => ({
  workflowFindFirst: vi.fn(),
  taskFindMany: vi.fn(),
  targetFindFirst: vi.fn(),
  targetFindMany: vi.fn(),
  loadProjectRunnerIds: vi.fn(),
  loadOrchestratorWorkflows: vi.fn(),
  listForProject: vi.fn(),
  agentKind: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      workflow: { findFirst: mocks.workflowFindFirst },
      orchestratorTask: { findMany: mocks.taskFindMany },
      computeTarget: {
        findFirst: mocks.targetFindFirst,
        findMany: mocks.targetFindMany,
      },
    }),
}));
vi.mock("@/lib/orchestrator/workflow-settings", () => ({
  loadOrchestratorWorkflows: mocks.loadOrchestratorWorkflows,
}));
vi.mock("@/app/compute-targets/capabilities-service", () => ({
  computeTargetCapabilitiesService: { listForProject: mocks.listForProject },
}));
vi.mock("@/app/compute-targets/fleet-service", () => ({
  agentKind: mocks.agentKind,
}));
vi.mock("@/app/projects/project-runner-selection", () => ({
  loadProjectRunnerIds: mocks.loadProjectRunnerIds,
}));

function file(
  computeTargetId: string,
  runnerName: string,
  source: RunnerCapabilitiesSource,
  role: string | null = null
) {
  return {
    computeTargetId,
    runnerName,
    isOnline: true,
    source,
    capabilities: role ? { runner: role } : null,
  };
}

describe("loadWorkflowAgentMap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.workflowFindFirst.mockResolvedValue({ id: WF, projectId: PROJECT });
    mocks.loadOrchestratorWorkflows.mockResolvedValue(
      new Map([[WF, { computeTargetId: "orch" }]])
    );
    mocks.listForProject.mockResolvedValue([]);
    mocks.taskFindMany.mockResolvedValue([]);
    mocks.loadProjectRunnerIds.mockResolvedValue([]);
    mocks.targetFindMany.mockResolvedValue([]);
    mocks.targetFindFirst.mockResolvedValue({
      id: "orch",
      machineName: "orchestrator-1",
      isOnline: true,
    });
  });

  it("is null for an unknown workflow", async () => {
    mocks.workflowFindFirst.mockResolvedValue(null);

    expect(await loadWorkflowAgentMap(ORG, WF)).toBeNull();
    expect(mocks.listForProject).not.toHaveBeenCalled();
  });

  it("lists declared agents then undeclared task targets for a project without Agents", async () => {
    mocks.listForProject.mockResolvedValue([
      file("qc", "qc-runner", RunnerCapabilitiesSource.Toolkit, "QC"),
      file("ba", "ba-runner", RunnerCapabilitiesSource.Personal, "BA"),
      file("ba", "ba-runner", RunnerCapabilitiesSource.Personal, "BA"),
    ]);
    mocks.agentKind.mockReturnValue(AgentKind.Personal);
    mocks.taskFindMany.mockResolvedValue([
      {
        computeTarget: {
          id: "dev",
          machineName: "dev-box",
          isOnline: false,
          capabilities: {},
        },
      },
      {
        computeTarget: {
          id: "ba",
          machineName: "ba-runner",
          isOnline: true,
          capabilities: {},
        },
      },
      {
        computeTarget: {
          id: "orch",
          machineName: "orchestrator-1",
          isOnline: true,
          capabilities: {},
        },
      },
    ]);

    const map = await loadWorkflowAgentMap(ORG, WF);

    expect(map?.orchestrator).toEqual({
      computeTargetId: "orch",
      name: "orchestrator-1",
      isOnline: true,
    });
    expect(map?.agents).toEqual([
      {
        computeTargetId: "ba",
        name: "ba-runner",
        isOnline: true,
        role: "BA",
        kind: AgentKind.Personal,
        declared: true,
      },
      {
        computeTargetId: "qc",
        name: "qc-runner",
        isOnline: true,
        role: "QC",
        kind: AgentKind.Automatic,
        declared: true,
      },
      {
        computeTargetId: "dev",
        name: "dev-box",
        isOnline: false,
        role: null,
        kind: AgentKind.Personal,
        declared: false,
      },
    ]);
  });

  it("lists exactly the project's Agents, offline or undeclared ones too", async () => {
    mocks.loadProjectRunnerIds.mockResolvedValue(["qc", "dev", "orch"]);
    mocks.listForProject.mockResolvedValue([
      file("qc", "qc-runner", RunnerCapabilitiesSource.Toolkit, "QC"),
    ]);
    mocks.agentKind.mockReturnValue(AgentKind.Automatic);
    mocks.targetFindMany.mockResolvedValue([
      { id: "qc", machineName: "qc-runner", isOnline: true, capabilities: {} },
      { id: "dev", machineName: "dev-box", isOnline: false, capabilities: {} },
      {
        id: "orch",
        machineName: "orchestrator-1",
        isOnline: true,
        capabilities: {},
      },
    ]);

    const map = await loadWorkflowAgentMap(ORG, WF);

    expect(mocks.loadProjectRunnerIds).toHaveBeenCalledWith(ORG, {
      projectId: PROJECT,
    });
    expect(mocks.targetFindMany.mock.calls[0][0].where).toEqual({
      id: { in: ["qc", "dev", "orch"] },
      organizationId: ORG,
    });
    // A removed Agent that ran a task is not looked up.
    expect(mocks.taskFindMany).not.toHaveBeenCalled();
    expect(map?.agents).toEqual([
      {
        computeTargetId: "qc",
        name: "qc-runner",
        isOnline: true,
        role: "QC",
        kind: AgentKind.Automatic,
        declared: true,
      },
      {
        computeTargetId: "dev",
        name: "dev-box",
        isOnline: false,
        role: null,
        kind: AgentKind.Automatic,
        declared: false,
      },
    ]);
  });

  it("has no orchestrator for a process workflow", async () => {
    mocks.loadOrchestratorWorkflows.mockResolvedValue(new Map());

    const map = await loadWorkflowAgentMap(ORG, WF);

    expect(map).toEqual({ orchestrator: null, agents: [] });
    expect(mocks.targetFindFirst).not.toHaveBeenCalled();
  });

  it("scopes every query to the organization", async () => {
    mocks.loadOrchestratorWorkflows.mockResolvedValue(
      new Map([[WF, { computeTargetId: "orch" }]])
    );

    await loadWorkflowAgentMap(ORG, WF);

    expect(mocks.workflowFindFirst.mock.calls[0][0].where).toEqual({
      id: WF,
      organizationId: ORG,
    });
    expect(mocks.loadOrchestratorWorkflows).toHaveBeenCalledWith(ORG, [WF]);
    expect(mocks.listForProject).toHaveBeenCalledWith(ORG, PROJECT);
    expect(mocks.taskFindMany.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG,
      case: { workflowId: WF },
    });
    expect(mocks.targetFindFirst.mock.calls[0][0].where).toEqual({
      id: "orch",
      organizationId: ORG,
    });
  });
});
