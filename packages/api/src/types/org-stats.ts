export type OrgProjectStats = { total: number; active7d: number };

export type OrgWorkflowStats = {
  total: number;
  orchestrated: number;
  process: number;
  enabled: number;
  disabled: number;
};

export type OrgSessionStats = { last7d: number; last30d: number };

export type OrgCaseTimeStats = {
  sampleSize: number;
  medianActiveMs: number | null;
  totalActiveMs: number;
  medianElapsedMs: number | null;
};

export type OrgCaseStats = {
  open: number;
  waitingForHuman: number;
  withBlockedOrFailedTasks: number;
  closed7d: number;
  closed30d: number;
  time7d: OrgCaseTimeStats;
  time30d: OrgCaseTimeStats;
};

export type OrgUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type OrgUsageRow = { id: string; name: string } & OrgUsageTotals;

export type OrgUsageStats = {
  last7d: OrgUsageTotals;
  last30d: OrgUsageTotals;
  topCases: OrgUsageRow[];
  topWorkflows: OrgUsageRow[];
  topProjects: OrgUsageRow[];
  topAgents: OrgUsageRow[];
};

export const OrgAttentionKind = {
  WaitingForHuman: "waiting_for_human",
  PendingDecision: "pending_decision",
  BlockedTask: "blocked_task",
  FailedTask: "failed_task",
  OfflineAgent: "offline_agent",
} as const;
export type OrgAttentionKind =
  (typeof OrgAttentionKind)[keyof typeof OrgAttentionKind];

export type OrgAttentionItem = {
  kind: OrgAttentionKind;
  title: string;
  detail: string | null;
  caseId: string | null;
  computeTargetId: string | null;
  projectName: string | null;
  workflowName: string | null;
  since: string;
};

export type OrgAttentionStats = {
  items: OrgAttentionItem[];
  tasks7d: { succeeded: number; failed: number; blocked: number };
  failedRuns7d: number;
  guardRefusals7d: number;
};

export const ORG_STATS_TOP_ROWS = 5;
export const ORG_ATTENTION_MAX_ITEMS = 10;

export const OrgStatsPath = {
  Projects: "/org-stats/projects",
  Workflows: "/org-stats/workflows",
  Cases: "/org-stats/cases",
  Sessions: "/org-stats/sessions",
  Usage: "/org-stats/usage",
  Attention: "/org-stats/attention",
} as const;
export type OrgStatsPath = (typeof OrgStatsPath)[keyof typeof OrgStatsPath];
