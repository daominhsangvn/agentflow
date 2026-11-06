import {
  OrchestratorCaseStatus,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
} from "@repo/api/src/types/orchestrator";
import { describe, expect, it } from "vitest";

import { caseNeedsPersonWhere } from "@/lib/orchestrator/case-needs-person";

describe("caseNeedsPersonWhere", () => {
  it("only matches open cases", () => {
    expect(caseNeedsPersonWhere().status).toBe(OrchestratorCaseStatus.Open);
  });

  it("excludes cases with a running turn or a scheduled wake", () => {
    expect(caseNeedsPersonWhere().conversations).toEqual({
      none: {
        OR: [
          { status: OrchestratorConversationStatus.Turn },
          { nextWakeAt: { not: null } },
        ],
      },
    });
  });

  it("matches a pending decision, an open question or an asked wait_human", () => {
    expect(caseNeedsPersonWhere().OR).toEqual([
      { decisions: { some: { status: OrchestratorDecisionStatus.Pending } } },
      { tasks: { some: { openQuestionCount: { gt: 0 } } } },
      { conversations: { some: { askedHuman: { not: null } } } },
    ]);
  });
});
