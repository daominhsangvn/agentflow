import type { OrchestratorCaseListItem } from "@repo/api/src/types/orchestrator";
import { describe, expect, it } from "vitest";

import {
  agentHasActiveTasks,
  agentHasOpenQuestions,
  agentNeedsCount,
  agentsInCase,
  casesForNode,
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
        openQuestionCount,
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
    expect(agentNeedsCount(cases, "a")).toBe(1);
    expect(agentNeedsCount(cases, "b")).toBe(1);
    expect(agentNeedsCount(cases, "z")).toBe(0);
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

  it("sorts needs-person first, then newest", () => {
    expect(sortInbox(cases).map((c) => c.id)).toEqual(["c3", "c2", "c4", "c1"]);
  });

  it("lists agent ids of a case", () => {
    expect(agentsInCase(cases[1])).toEqual(["a", "b"]);
  });
});
