import {
  OrchestratorPageOperation,
  OrchestratorSourceOperation,
  OrchestratorTeamsOperation,
} from "@repo/api/src/types/orchestrator-grants";
import {
  type SaveWorkflowInput,
  saveWorkflowInputSchema,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { describe, expect, it, vi } from "vitest";
import { FAKE_TRIGGER_TYPE } from "@/lib/workflows/__tests__/support/workflow-registry.test-fake";
import { validateWorkflowInput } from "@/lib/workflows/workflow-validation";

/**
 * A workflow handed to the orchestrator (`agent.mode: orchestrated`,
 * docs/orchestrator.md) starts no run: it has no process of its own and runs
 * on one runner.
 */

const IDS = {
  org: "0199a5f0-0000-7000-8000-00000000000a",
  caller: "0199a5f0-0000-7000-8000-0000000000a1",
  project: "0199a5f0-0000-7000-8000-0000000000d1",
  target: "0199a5f0-0000-7000-8000-0000000000c1",
};

vi.mock("@repo/database", () => {
  const db = {
    project: {
      findMany: (args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          args.where.id.in.map((id) => ({ id, name: "Billing" }))
        ),
    },
    user: {
      findFirst: (args: { where: { id: string } }) =>
        Promise.resolve({ id: args.where.id }),
    },
    projectConnection: {
      findMany: () =>
        Promise.resolve([
          {
            id: "pc-jira",
            projectId: IDS.project,
            key: "jira",
            name: "jira",
            provider: "fake",
            settings: { projectKeys: ["PROJ"] },
            connectionId: "conn-jira",
            credentialsEncrypted: null,
            connection: { provider: "fake" },
          },
          {
            id: "pc-wiki",
            projectId: IDS.project,
            key: "wiki",
            name: "wiki",
            provider: "confluence",
            settings: {},
            connectionId: "conn-wiki",
            credentialsEncrypted: null,
            connection: { provider: "confluence" },
          },
          {
            id: "pc-teams",
            projectId: IDS.project,
            key: "teams",
            name: "teams",
            provider: "microsoft_teams",
            settings: { askChannels: ["qa-backend = 19:a@thread.tacv2"] },
            connectionId: "conn-teams",
            credentialsEncrypted: null,
            connection: { provider: "microsoft_teams" },
          },
          {
            id: "pc-teams-bare",
            projectId: IDS.project,
            key: "teams-bare",
            name: "teams-bare",
            provider: "microsoft_teams",
            settings: {},
            connectionId: "conn-teams-bare",
            credentialsEncrypted: null,
            connection: { provider: "microsoft_teams" },
          },
        ]),
    },
  };
  return { withDb: (fn: (client: unknown) => unknown) => fn(db) };
});
vi.mock("@/app/compute-targets/service", () => ({
  computeTargetsService: {
    findOwnedById: () => Promise.resolve({ id: "target" }),
    findAccessibleById: () => Promise.resolve(null),
  },
}));
vi.mock("@/app/projects/project-process-service", () => ({
  checkProcessToolkit: () => Promise.resolve(null),
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

describe("validateWorkflowInput — orchestrated", () => {
  it("accepts an orchestrated workflow without any project setup", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated);
    expect(result.ok).toBe(true);
  });

  it("refuses a process of its own", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated, {
      toolkit: null,
      steps: [
        {
          type: "agentflow.plan",
          id: "plan",
          name: "Plan",
        },
      ],
    });
    expect(result.ok ? "" : result.error).toContain(
      "has no process of its own"
    );
  });

  it("refuses runner rules", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated, null, [
      { condition: 'source.type == "bug"', computeTargetId: IDS.target },
    ]);
    expect(result.ok ? "" : result.error).toContain("remove agent.runners");
  });

  it("accepts a Confluence connection granted publish", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated, null, [], {
      wiki: [OrchestratorPageOperation.Publish],
    });
    expect(result.ok).toBe(true);
  });

  it("refuses an unknown connection key", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated, null, [], {
      missing: [OrchestratorPageOperation.Publish],
    });
    expect(result.ok ? "" : result.error).toContain(
      'has no connection "missing"'
    );
  });

  it("refuses a connection that is not Confluence", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated, null, [], {
      jira: [OrchestratorPageOperation.Publish],
    });
    expect(result.ok ? "" : result.error).toContain(
      "writes only Confluence pages"
    );
  });

  it("accepts a Teams connection with ask channels granted ask", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated, null, [], {
      teams: [OrchestratorTeamsOperation.Ask],
    });
    expect(result.ok).toBe(true);
  });

  it("refuses ask on a connection that is not Microsoft Teams", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated, null, [], {
      wiki: [OrchestratorTeamsOperation.Ask],
    });
    expect(result.ok ? "" : result.error).toContain(
      "ask is for a Microsoft Teams connection"
    );
  });

  it("refuses ask when the Teams connection has no Ask channels", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated, null, [], {
      "teams-bare": [OrchestratorTeamsOperation.Ask],
    });
    expect(result.ok ? "" : result.error).toContain(
      "needs at least one Ask channel"
    );
  });

  it("refuses a source operation no trigger connection offers", async () => {
    const result = await validate(WorkflowAgentMode.Orchestrated, null, [], {
      source: [OrchestratorSourceOperation.Transition],
    });
    expect(result.ok ? "" : result.error).toContain("can transition its items");
  });

  it("refuses grants on a workflow that is not orchestrated", async () => {
    const result = await validate(WorkflowAgentMode.Plan, null, [], {
      source: [OrchestratorSourceOperation.Comment],
    });
    expect(result.ok ? "" : result.error).toContain(
      "only an orchestrated workflow"
    );
  });

  it("leaves the other modes unaffected", async () => {
    const result = await validate(WorkflowAgentMode.Plan);
    expect(result.ok).toBe(true);
  });
});

function validate(
  mode: WorkflowAgentMode,
  process: unknown = null,
  runners: unknown[] = [],
  connections: Record<string, string[]> = {}
) {
  const input: SaveWorkflowInput = saveWorkflowInputSchema.parse({
    name: "Questions to the orchestrator",
    projectId: IDS.project,
    agent: {
      computeTargetId: IDS.target,
      mode,
      process,
      runners,
      orchestrator: { connections },
    },
    triggers: [{ connectionKey: "jira", type: FAKE_TRIGGER_TYPE }],
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
