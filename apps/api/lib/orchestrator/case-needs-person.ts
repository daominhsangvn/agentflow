import {
  OrchestratorCaseStatus,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
} from "@repo/api/src/types/orchestrator";
import type { Prisma } from "@repo/database";

/**
 * The one definition of "needs a person" (docs/orchestrator.md): an open case
 * whose orchestrator is not working (no running turn, no wake scheduled) and
 * that has a pending decision, an agent question no answer covers, or a
 * wait_human with `asked`.
 *
 * Callers combine it with `AND: [base, caseNeedsPersonWhere()]`, never by
 * spreading: a `status` filter in `base` would be overwritten.
 */
export function caseNeedsPersonWhere(): Prisma.OrchestratorCaseWhereInput {
  return {
    status: OrchestratorCaseStatus.Open,
    conversations: {
      none: {
        OR: [
          { status: OrchestratorConversationStatus.Turn },
          { nextWakeAt: { not: null } },
        ],
      },
    },
    OR: [
      { decisions: { some: { status: OrchestratorDecisionStatus.Pending } } },
      { tasks: { some: { openQuestionCount: { gt: 0 } } } },
      { conversations: { some: { askedHuman: { not: null } } } },
    ],
  };
}
