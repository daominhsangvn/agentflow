import type {
  RunnerCapabilitiesSource,
  RunnerCommand,
} from "./runner-capabilities.ts";
import type { WorkflowAgentMode } from "./workflow-agent-mode.ts";

// Dates are ISO strings with names outside the API client's date-revival allowlist.

export const AgentKind = {
  Automatic: "automatic",
  Personal: "personal",
} as const;
export type AgentKind = (typeof AgentKind)[keyof typeof AgentKind];

export const ClaudeCodeVersionStatus = {
  Match: "match",
  Mismatch: "mismatch",
  /** Pinned to latest: nothing to compare. */
  Latest: "latest",
  /** No reported version. */
  Unknown: "unknown",
} as const;
export type ClaudeCodeVersionStatus =
  (typeof ClaudeCodeVersionStatus)[keyof typeof ClaudeCodeVersionStatus];

export const AgentWorkflowRole = {
  /** An orchestrated workflow's runner. */
  Orchestrator: "orchestrator",
  /** A process workflow's runner. */
  Default: "default",
  /** A runner rule names it. */
  Rule: "rule",
  /** Orchestrated workflow of a project it serves. */
  ProjectAgent: "project_agent",
} as const;
export type AgentWorkflowRole =
  (typeof AgentWorkflowRole)[keyof typeof AgentWorkflowRole];

export const AgentWorkStatus = {
  Queued: "queued",
  Running: "running",
  Succeeded: "succeeded",
  Blocked: "blocked",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;
export type AgentWorkStatus =
  (typeof AgentWorkStatus)[keyof typeof AgentWorkStatus];

export const AgentWorkKind = { Task: "task", RunLoop: "run_loop" } as const;
export type AgentWorkKind = (typeof AgentWorkKind)[keyof typeof AgentWorkKind];

export type AgentFleetProject = {
  id: string;
  name: string;
  commands: string[];
  problemCount: number;
};

export type AgentFleetEntry = {
  id: string;
  machineName: string;
  displayName: string | null;
  kind: AgentKind;
  ownerName: string | null;
  isSharedWithOrg: boolean;
  isOnline: boolean;
  lastSeen: string;
  health: {
    healthChecked: string;
    allRequiredPassed: boolean;
    requiredFailureCount: number;
  } | null;
  claudeCode: {
    reported: string | null;
    pinned: string;
    status: ClaudeCodeVersionStatus;
  };
  projects: AgentFleetProject[];
  enabledWorkflowCount: number;
};

export type AgentFleetResponse = { agents: AgentFleetEntry[] };

export type AgentToolCheck = {
  id: string;
  label: string;
  required: boolean;
  passed: boolean;
  version: string | null;
};

export type AgentCapabilityFile = {
  projectId: string;
  projectName: string;
  source: RunnerCapabilitiesSource;
  roleName: string | null;
  commands: RunnerCommand[];
  problems: string[];
  warnings: string[];
  uploaded: string;
};

export type AgentWorkflowUse = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  mode: WorkflowAgentMode;
  roles: AgentWorkflowRole[];
};

export type AgentRecentWork = {
  id: string;
  kind: AgentWorkKind;
  command: string;
  status: AgentWorkStatus;
  caseId: string | null;
  caseTitle: string | null;
  runId: string | null;
  workflowId: string | null;
  label: string;
  started: string;
  finished: string | null;
  activeMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type AgentUsageWindow = {
  tasks: number;
  succeeded: number;
  failed: number;
  blocked: number;
  activeMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type AgentDetail = {
  agent: AgentFleetEntry;
  healthTools: AgentToolCheck[];
  capabilities: AgentCapabilityFile[];
  projects: { id: string; name: string }[];
  workflows: AgentWorkflowUse[];
  recentWork: AgentRecentWork[];
  usage: { last7d: AgentUsageWindow; last30d: AgentUsageWindow };
};

export const AGENT_RECENT_WORK_MAX = 20;
