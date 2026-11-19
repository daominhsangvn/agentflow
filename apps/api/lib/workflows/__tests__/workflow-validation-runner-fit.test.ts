import {
  type SaveWorkflowInput,
  saveWorkflowInputSchema,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_TRIGGER_TYPE } from "@/lib/workflows/__tests__/support/workflow-registry.test-fake";
import { validateWorkflowInput } from "@/lib/workflows/workflow-validation";

/** A personal runner runs agent steps only and never pushes (docs/workflows.md). */

const IDS = {
  org: "0199a5f0-0000-7000-8000-00000000000a",
  caller: "0199a5f0-0000-7000-8000-0000000000a1",
  project: "0199a5f0-0000-7000-8000-0000000000d1",
  project2: "0199a5f0-0000-7000-8000-0000000000d2",
  target: "0199a5f0-0000-7000-8000-0000000000c1",
};

const mocks = vi.hoisted(() => ({
  findCurrent: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const db = {
    project: {
      findMany: (args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          args.where.id.in.map((id) => ({
            id,
            name: id === IDS.project2 ? "Shipping" : "Billing",
            agents: [],
          }))
        ),
    },
    user: {
      findFirst: (args: { where: { id: string } }) =>
        Promise.resolve({ id: args.where.id }),
    },
    projectConnection: {
      findMany: () =>
        Promise.resolve(
          [IDS.project, IDS.project2].map((projectId) => ({
            id: `pc-jira-${projectId}`,
            projectId,
            key: "jira",
            name: "jira",
            provider: "fake",
            settings: { projectKeys: ["PROJ"] },
            connectionId: "conn-jira",
            credentialsEncrypted: null,
            connection: { provider: "fake" },
          }))
        ),
    },
  };
  return { withDb: (fn: (client: unknown) => unknown) => fn(db) };
});
vi.mock("@/app/compute-targets/service", () => ({
  computeTargetsService: {
    findOwnedById: () =>
      Promise.resolve({
        id: "target",
        machineName: "PRO-1-BA",
        isSharedWithOrg: false,
        capabilities: { personalRunner: { projectKey: "PRO-1" } },
      }),
    findAccessibleById: () => Promise.resolve(null),
  },
}));
vi.mock("@/app/projects/project-process-service", () => ({
  CurrentProcessKind: { None: "none", Found: "found", Invalid: "invalid" },
  checkProcessToolkit: () => Promise.resolve(null),
  projectProcessService: { findCurrent: mocks.findCurrent },
}));
vi.mock("@/app/projects/project-repository-checkouts", () => ({
  listProjectRepositoryCheckouts: () => Promise.resolve([]),
}));
vi.mock("@/lib/integrations/registry", async () => {
  const support = await import(
    "@/lib/workflows/__tests__/support/workflow-registry.test-fake"
  );
  return support.fakeWorkflowRegistry;
});

const AGENT_PROCESS = {
  toolkit: null,
  steps: [{ type: "agent", id: "ask", name: "Ask", instruction: "/ask x" }],
};

describe("validateWorkflowInput — personal runner fit", () => {
  beforeEach(() => {
    mocks.findCurrent.mockReset();
    mocks.findCurrent.mockResolvedValue({ kind: "none" });
  });

  it("refuses a PLAN/EXECUTE workflow without any process", async () => {
    const result = await validate(WorkflowAgentMode.Plan);
    expect(result.ok ? "" : result.error).toContain("personal runner");
  });

  it("accepts the project's own process of agent steps", async () => {
    mocks.findCurrent.mockResolvedValue({
      kind: "found",
      snapshot: { version: 1, source: "project", definition: AGENT_PROCESS },
    });
    const result = await validate(WorkflowAgentMode.Plan);
    expect(result.ok).toBe(true);
  });

  it("accepts an own process with an agent step", async () => {
    const result = await validate(WorkflowAgentMode.Plan, AGENT_PROCESS);
    expect(result.ok).toBe(true);
  });

  it("refuses an agent step that finishes with a push", async () => {
    const result = await validate(WorkflowAgentMode.Plan, {
      toolkit: null,
      steps: [
        {
          type: "agent",
          id: "ask",
          name: "Ask",
          instruction: "/ask x",
          finish: "push",
        },
      ],
    });
    expect(result.ok ? "" : result.error).toContain("personal runner");
  });

  it("refuses a trigger project without a process", async () => {
    mocks.findCurrent.mockImplementation((_org: string, id: string) =>
      Promise.resolve(id === IDS.project ? foundProcess() : { kind: "none" })
    );
    const result = await validate(
      WorkflowAgentMode.Plan,
      null,
      [],
      IDS.project2
    );
    const error = result.ok ? "" : result.error;
    expect(error).toContain("Runs of trigger project");
    expect(error).toContain("Shipping");
  });

  it("accepts a trigger project with a process of agent steps", async () => {
    mocks.findCurrent.mockResolvedValue(foundProcess());
    const result = await validate(
      WorkflowAgentMode.Plan,
      null,
      [],
      IDS.project2
    );
    expect(result.ok).toBe(true);
  });

  it("lets the own process win over a trigger project without one", async () => {
    mocks.findCurrent.mockResolvedValue({ kind: "none" });
    const result = await validate(
      WorkflowAgentMode.Plan,
      AGENT_PROCESS,
      [],
      IDS.project2
    );
    expect(result.ok).toBe(true);
  });

  it("accepts an orchestrated workflow", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated);
    expect(result.ok).toBe(true);
  });

  it("refuses a runner rule on a personal runner without a process", async () => {
    const result = await validate(WorkflowAgentMode.Plan, null, [
      { condition: 'source.type == "bug"', computeTargetId: IDS.target },
    ]);
    expect(result.ok ? "" : result.error).toContain("personal runner");
  });
});

function validate(
  mode: WorkflowAgentMode,
  process: unknown = null,
  runners: unknown[] = [],
  triggerProjectId?: string
) {
  const input: SaveWorkflowInput = saveWorkflowInputSchema.parse({
    name: "Fit",
    projectId: IDS.project,
    agent: { computeTargetId: IDS.target, mode, process, runners },
    triggers: [
      {
        connectionKey: "jira",
        type: FAKE_TRIGGER_TYPE,
        ...(triggerProjectId ? { projectId: triggerProjectId } : {}),
      },
    ],
    actions: [],
  });
  return validateWorkflowInput(
    {
      organizationId: IDS.org,
      callerId: IDS.caller,
      defaultRunAsUserId: IDS.caller,
      existing: { triggerIds: new Set(), actionIds: new Set() },
      workflowId: null,
    },
    input
  );
}

function foundProcess() {
  return {
    kind: "found",
    snapshot: { version: 1, source: "project", definition: AGENT_PROCESS },
  };
}
