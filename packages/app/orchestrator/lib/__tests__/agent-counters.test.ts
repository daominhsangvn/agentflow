import {
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { describe, expect, it } from "vitest";

import {
  agentActiveTaskCount,
  agentHasActiveTasks,
  agentHasOpenQuestions,
  agentLatestError,
  agentNeedsPerson,
  agentsInCase,
  caseAgentState,
  casesForNode,
  LATEST_TASK_FAILED,
  ORCHESTRATOR_NODE_ID,
  orchestratorNeedsCount,
  sortInbox,
} from "../agent-counters";

function item(
  id: string,
  needsPerson: boolean,
  updatedAt: string,
  agents: [string, number, number][]
): OrchestratorCaseListItem {
  return {
    id,
    needsPerson,
    updatedAt,
    agents: agents.map(
      ([computeTargetId, activeTaskCount, openQuestionCount]) => ({
        computeTargetId,
        activeTaskCount,
        runningTaskCount: activeTaskCount,
        queuedTaskCount: 0,
        openQuestionCount,
        latestTaskStatus: null,
        latestTaskError: null,
        latestTaskWaiting: null,
      })
    ),
  } as unknown as OrchestratorCaseListItem;
}

const cases = [
  item("c1", false, "2026-01-01T00:00:00Z", [["a", 1, 0]]),
  item("c2", true, "2026-01-02T00:00:00Z", [
    ["a", 0, 2],
    ["b", 0, 0],
  ]),
  item("c3", true, "2026-01-03T00:00:00Z", [["b", 0, 1]]),
  item("c4", false, "2026-01-04T00:00:00Z", [["a", 0, 1]]),
];

describe("agent counters", () => {
  it("counts needs-person cases for the orchestrator", () => {
    expect(orchestratorNeedsCount(cases)).toBe(2);
  });

  it("counts an agent only when needsPerson and it has open questions", () => {
    expect(agentNeedsPerson(cases, "a")).toBe(true);
    expect(agentNeedsPerson(cases, "b")).toBe(true);
    expect(agentNeedsPerson(cases, "z")).toBe(false);
  });

  it("detects active tasks and open questions", () => {
    expect(agentHasActiveTasks(cases, "a")).toBe(true);
    expect(agentHasActiveTasks(cases, "b")).toBe(false);
    expect(agentHasOpenQuestions(cases, "b")).toBe(true);
    expect(agentHasOpenQuestions(cases, "z")).toBe(false);
  });

  it("filters cases per node", () => {
    expect(casesForNode(cases, ORCHESTRATOR_NODE_ID)).toHaveLength(4);
    expect(casesForNode(cases, "b").map((c) => c.id)).toEqual(["c2", "c3"]);
  });

  it("sorts newest first", () => {
    expect(sortInbox(cases).map((c) => c.id)).toEqual(["c4", "c3", "c2", "c1"]);
  });

  it("lists agent ids of a case", () => {
    expect(agentsInCase(cases[1])).toEqual(["a", "b"]);
  });

  it("sums active tasks and detects needs-person per agent", () => {
    expect(agentActiveTaskCount(cases, "a")).toBe(1);
    expect(agentActiveTaskCount(cases, "z")).toBe(0);
    expect(agentNeedsPerson(cases, "a")).toBe(true);
    expect(agentNeedsPerson(cases, "z")).toBe(false);
  });

  describe("errors", () => {
    function failing(
      id: string,
      updatedAt: string,
      error: string | null,
      status?: string
    ): OrchestratorCaseListItem {
      const base = item(id, false, updatedAt, [["a", 0, 0]]);
      base.agents[0].latestTaskStatus = OrchestratorTaskStatus.Failed;
      base.agents[0].latestTaskError = error;
      return { ...base, status } as unknown as OrchestratorCaseListItem;
    }

    it("ignores closed cases and takes the newest failure", () => {
      const list = [
        failing("e1", "2026-01-01T00:00:00Z", "old"),
        failing("e2", "2026-01-02T00:00:00Z", "new"),
        failing(
          "e3",
          "2026-01-03T00:00:00Z",
          "closed",
          OrchestratorCaseStatus.Closed
        ),
      ];
      expect(agentLatestError(list, "a")).toBe("new");
      expect(agentLatestError(list, "z")).toBeNull();
    });

    it("falls back when the error text is missing", () => {
      const list = [failing("e1", "2026-01-01T00:00:00Z", null)];
      expect(agentLatestError(list, "a")).toBe(LATEST_TASK_FAILED);
      expect(caseAgentState(list[0], "a")?.error).toBe(LATEST_TASK_FAILED);
    });

    it("caseAgentState is null for an absent agent", () => {
      expect(caseAgentState(cases[0], "z")).toBeNull();
      expect(caseAgentState(cases[1], "a")).toMatchObject({
        running: 0,
        needsPerson: true,
        error: null,
      });
    });
  });
});
