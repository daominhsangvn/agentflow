import type {
  OrchestratorCaseAgent,
  OrchestratorCaseListItem,
} from "@repo/api/src/types/orchestrator";

export const CasePersonBadgeKind = {
  Decision: "decision",
  Questions: "questions",
  Asked: "asked",
} as const;
export type CasePersonBadgeKind =
  (typeof CasePersonBadgeKind)[keyof typeof CasePersonBadgeKind];

export type CasePersonBadge = {
  key: string;
  kind: CasePersonBadgeKind;
  label: string;
  title: string | null;
};

/** Why a person is needed in the case, for the inbox row. Empty unless the case needs a person. */
export function casePersonBadges(
  item: OrchestratorCaseListItem,
  agentId: string | null,
  agentNames: Readonly<Record<string, string>>
): CasePersonBadge[] {
  if (!item.needsPerson) {
    return [];
  }
  const badges: CasePersonBadge[] = [];
  if (item.pendingDecisionCount > 0) {
    badges.push({
      key: "decision",
      kind: CasePersonBadgeKind.Decision,
      label: "Decision pending",
      title: decisionCountLabel(item.pendingDecisionCount),
    });
  }
  badges.push(...questionBadges(item, agentId, agentNames));
  if (item.askedHuman) {
    badges.push({
      key: "asked",
      kind: CasePersonBadgeKind.Asked,
      label: "Asked",
      title: item.askedHuman,
    });
  }
  return badges;
}

export function questionCountLabel(count: number): string {
  return count === 1 ? "1 question" : `${count} questions`;
}

function decisionCountLabel(count: number): string {
  return count === 1 ? "1 pending decision" : `${count} pending decisions`;
}

function questionBadges(
  item: OrchestratorCaseListItem,
  agentId: string | null,
  agentNames: Readonly<Record<string, string>>
): CasePersonBadge[] {
  const withQuestions = item.agents.filter(
    (agent) =>
      agent.openQuestionCount > 0 &&
      (agentId === null || agent.computeTargetId === agentId)
  );
  return withQuestions.map((agent) =>
    questionBadge(agent, agentId === null ? agentNames : null)
  );
}

function questionBadge(
  agent: OrchestratorCaseAgent,
  agentNames: Readonly<Record<string, string>> | null
): CasePersonBadge {
  const count = questionCountLabel(agent.openQuestionCount);
  if (!agentNames) {
    return {
      key: agent.computeTargetId,
      kind: CasePersonBadgeKind.Questions,
      label: count,
      title: null,
    };
  }
  const name = agentNames[agent.computeTargetId];
  return {
    key: agent.computeTargetId,
    kind: CasePersonBadgeKind.Questions,
    label: name ? `Questions from ${name}` : count,
    title: count,
  };
}
