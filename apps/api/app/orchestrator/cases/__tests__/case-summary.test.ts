import {
  type OrchestratorCaseListSummary,
  OrchestratorCaseStatus,
} from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorCaseService } from "@/app/orchestrator/cases/service";
import { caseNeedsPersonWhere } from "@/lib/orchestrator/case-needs-person";

const ORG = "org-1";
const PROJECT = "0199a5f0-0000-7000-8000-0000000000c1";
const WORKFLOW = "0199a5f0-0000-7000-8000-0000000000f1";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
}));

vi.mock("@/app/orchestrator/cases/service/case-messages", () => ({
  postCaseMessage: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  Prisma: { sql: (...parts: unknown[]) => parts },
  withDb: (fn: (db: unknown) => unknown) =>
    fn({ orchestratorCase: { count: mocks.count } }),
}));

describe("orchestratorCaseService.summaryForOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4);
  });

  it("returns the four counts", async () => {
    const summary: OrchestratorCaseListSummary =
      await orchestratorCaseService.summaryForOrg(ORG, {});

    expect(summary).toEqual({ total: 9, open: 5, needsPerson: 2, closed: 4 });
  });

  it("carries org, project and workflow filters into every count", async () => {
    await orchestratorCaseService.summaryForOrg(ORG, {
      projectId: PROJECT,
      workflowId: WORKFLOW,
    });

    const base = {
      organizationId: ORG,
      projectId: PROJECT,
      workflowId: WORKFLOW,
    };
    const wheres = mocks.count.mock.calls.map((call) => call[0].where);
    expect(wheres[0]).toEqual(base);
    expect(wheres[1]).toEqual({
      AND: [base, { status: OrchestratorCaseStatus.Open }],
    });
    expect(wheres[2]).toEqual({ AND: [base, caseNeedsPersonWhere()] });
    expect(wheres[3]).toEqual({
      AND: [base, { status: OrchestratorCaseStatus.Closed }],
    });
  });

  it("keeps the status filter in the base so closed implies zero open", async () => {
    await orchestratorCaseService.summaryForOrg(ORG, {
      status: OrchestratorCaseStatus.Closed,
    });

    const base = { organizationId: ORG, status: OrchestratorCaseStatus.Closed };
    const wheres = mocks.count.mock.calls.map((call) => call[0].where);
    expect(wheres[0]).toEqual(base);
    expect(wheres[1]).toEqual({
      AND: [base, { status: OrchestratorCaseStatus.Open }],
    });
  });
});
