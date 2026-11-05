import {
  OrchestratorMessageKind,
  OrchestratorToolName,
} from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorToolService } from "@/app/orchestrator-tools/service";
import { hashOrchestratorToken } from "@/app/orchestrator-tools/token";

/** case_lookup reads the cases of another item of the project, read only. */

const TOKEN = "ost_abcdefghijklmnopqrstuvwxyz0123456789";

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  cases: [] as Row[],
  caseFind: vi.fn(),
  caseLookup: true,
  turnSuperseded: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const db = {
    orchestratorTurn: {
      findFirst: () =>
        Promise.resolve({
          id: "turn-1",
          organizationId: "org-1",
          tokenHash: hashOrchestratorToken(TOKEN),
          conversation: {
            id: "conversation-1",
            projectId: "project-1",
            caseId: "case-1",
            projectConnectionId: "0199a5f0-0000-7000-8000-0000000000e1",
            case: { workflowId: "workflow-1" },
            channel: null,
          },
        }),
    },
    orchestratorMessage: {
      create: (args: { data: Row }) => {
        mocks.messages.push(args.data);
        return Promise.resolve(args.data);
      },
    },
    orchestratorCase: {
      findMany: (args: unknown) => {
        mocks.caseFind(args);
        return Promise.resolve(mocks.cases);
      },
    },
    organization: { findUnique: () => Promise.resolve({ slug: "agentflow" }) },
  };
  const withDb = (fn: (client: unknown) => unknown) => fn(db);
  withDb.tx = (fn: (client: unknown) => unknown) => fn(db);
  return { withDb };
});
vi.mock("@/lib/orchestrator/workflow-settings", async () => {
  const { workflowsWith } = await import(
    "@/__tests__/support/orchestrator-tools/grants.test-fixtures"
  );
  return {
    loadOrchestratorWorkflows: async () => {
      const map = await workflowsWith({});
      return new Map([
        [
          "workflow-1",
          {
            ...map.get("workflow-1"),
            caseLookup: mocks.caseLookup,
            caseHandoff: false,
          },
        ],
      ]);
    },
  };
});
vi.mock("@/lib/orchestrator/supersede", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/supersede")>()),
  turnSuperseded: () => mocks.turnSuperseded(),
}));
vi.mock("@/lib/orchestrator/advance", () => ({
  advanceConversation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wait-until", () => ({ waitUntil: vi.fn() }));
vi.mock("@/lib/orchestrator/case-render", () => ({
  renderCase: (id: string) => Promise.resolve(`# case ${id}`),
}));
vi.mock("@/lib/orchestrator/tasks", () => ({ startTask: vi.fn() }));
vi.mock("@/lib/orchestrator/task-cancel", () => ({ cancelTask: vi.fn() }));
vi.mock("@/lib/orchestrator/decisions", () => ({
  requestDecision: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("@/lib/orchestrator/waits", () => ({
  createWait: vi.fn(),
  evaluateWaits: vi.fn(),
}));
vi.mock("@/lib/integrations/project-connections", () => ({
  loadProjectConnectionRuntime: () => Promise.resolve(null),
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  createProviderContext: () => ({}),
}));
vi.mock("@/app/compute-targets/capabilities-service", () => ({
  computeTargetCapabilitiesService: {
    listForProject: () => Promise.resolve([]),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messages = [];
  mocks.cases = [];
  mocks.caseLookup = true;
  mocks.turnSuperseded.mockResolvedValue(false);
});

async function lookup(input: Record<string, unknown>) {
  const result = await orchestratorToolService.call(
    TOKEN,
    OrchestratorToolName.CaseLookup,
    input as never
  );
  if (!result.ok) {
    throw new Error("unauthorized");
  }
  return result.value;
}

function row(id: string, workflowName: string) {
  return {
    id,
    status: "open",
    title: `Leave ${id}`,
    sourceKey: "jira:LD-6",
    workflowId: `workflow-${id}`,
    workflow: { name: workflowName },
  };
}

describe("case_lookup", () => {
  it("is listed only when caseLookup is on, never case_handoff", async () => {
    const on = await orchestratorToolService.describe(TOKEN);
    const onNames = on.ok ? on.value.tools.map((t) => t.name) : [];
    expect(onNames).toContain(OrchestratorToolName.CaseLookup);
    expect(onNames).not.toContain(OrchestratorToolName.CaseHandoff);
    mocks.caseLookup = false;
    const off = await orchestratorToolService.describe(TOKEN);
    const offNames = off.ok ? off.value.tools.map((t) => t.name) : [];
    expect(offNames).not.toContain(OrchestratorToolName.CaseLookup);
  });

  it("is refused and audited when off", async () => {
    mocks.caseLookup = false;
    const outcome = await lookup({ itemKey: "LD-6" });
    expect(outcome.ok).toBe(false);
    expect(mocks.caseFind).not.toHaveBeenCalled();
    expect(
      mocks.messages.some((m) => m.kind === OrchestratorMessageKind.ToolRefused)
    ).toBe(true);
  });

  it("queries the project's cases of the item, org-scoped", async () => {
    await lookup({ itemKey: "LD-6" });
    expect(mocks.caseFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          projectId: "project-1",
          id: { not: "case-1" },
          sourceKey: { endsWith: ":LD-6", mode: "insensitive" },
        },
      })
    );
  });

  it("returns each case with its CASE.md and workflow name", async () => {
    mocks.cases = [row("case-2", "Dev"), row("case-3", "QC")];
    const outcome = await lookup({ itemKey: "LD-6" });
    expect(outcome).toMatchObject({
      ok: true,
      output: {
        itemKey: "LD-6",
        cases: [
          { caseId: "case-2", workflow: "Dev", case: "# case case-2" },
          { caseId: "case-3", workflow: "QC", case: "# case case-3" },
        ],
      },
    });
  });

  it("returns no cases as ok", async () => {
    const outcome = await lookup({ itemKey: "LD-6" });
    expect(outcome).toMatchObject({ ok: true, output: { cases: [] } });
  });

  it("refuses an invalid itemKey", async () => {
    const outcome = await lookup({ itemKey: "LD 6; drop" });
    expect(outcome.ok).toBe(false);
    expect(mocks.caseFind).not.toHaveBeenCalled();
  });
});
