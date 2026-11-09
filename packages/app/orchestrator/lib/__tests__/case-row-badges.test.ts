import type { OrchestratorCaseListItem } from "@repo/api/src/types/orchestrator";
import { describe, expect, it } from "vitest";
import {
  CasePersonBadgeKind,
  casePersonBadges,
  questionCountLabel,
} from "../case-row-badges";

function item(
  overrides: Partial<OrchestratorCaseListItem>,
  questions: [string, number][] = []
): OrchestratorCaseListItem {
  return {
    needsPerson: true,
    pendingDecisionCount: 0,
    askedHuman: null,
    agents: questions.map(([computeTargetId, openQuestionCount]) => ({
      computeTargetId,
      openQuestionCount,
    })),
    ...overrides,
  } as unknown as OrchestratorCaseListItem;
}

describe("casePersonBadges", () => {
  it("is empty when the case does not need a person", () => {
    expect(
      casePersonBadges(
        item({ needsPerson: false, pendingDecisionCount: 2 }, [["ba", 1]]),
        null,
        {}
      )
    ).toEqual([]);
  });

  it("shows the decision badge only with pending decisions", () => {
    expect(casePersonBadges(item({}), null, {})).toEqual([]);
    const badges = casePersonBadges(
      item({ pendingDecisionCount: 2 }),
      null,
      {}
    );
    expect(badges).toHaveLength(1);
    expect(badges[0]).toMatchObject({
      kind: CasePersonBadgeKind.Decision,
      label: "Decision pending",
      title: "2 pending decisions",
    });
  });

  it("counts the selected agent's questions", () => {
    expect(casePersonBadges(item({}, [["ba", 2]]), "ba", {})[0].label).toBe(
      "2 questions"
    );
    expect(casePersonBadges(item({}, [["ba", 1]]), "ba", {})[0].label).toBe(
      "1 question"
    );
  });

  it("ignores other agents' questions on a selected agent", () => {
    const list = item({}, [
      ["ba", 0],
      ["dev", 3],
    ]);
    expect(casePersonBadges(list, "ba", {})).toEqual([]);
  });

  it("names the agent on the orchestrator's inbox", () => {
    const list = item({}, [
      ["ba", 2],
      ["dev", 1],
    ]);
    const badges = casePersonBadges(list, null, { ba: "BA", dev: "Dev" });
    expect(badges.map((b) => b.label)).toEqual([
      "Questions from BA",
      "Questions from Dev",
    ]);
    expect(badges[0].title).toBe("2 questions");
  });

  it("falls back to the count for an unknown agent name", () => {
    expect(casePersonBadges(item({}, [["x", 3]]), null, {})[0].label).toBe(
      "3 questions"
    );
  });

  it("shows Asked with the question as title, after the others", () => {
    const badges = casePersonBadges(
      item({ pendingDecisionCount: 1, askedHuman: "Which date?" }, [["ba", 1]]),
      "ba",
      {}
    );
    expect(badges.map((b) => b.kind)).toEqual([
      CasePersonBadgeKind.Decision,
      CasePersonBadgeKind.Questions,
      CasePersonBadgeKind.Asked,
    ]);
    expect(badges[2].title).toBe("Which date?");
  });

  it("labels question counts", () => {
    expect(questionCountLabel(1)).toBe("1 question");
    expect(questionCountLabel(4)).toBe("4 questions");
  });
});
