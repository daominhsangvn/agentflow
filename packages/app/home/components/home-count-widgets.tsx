"use client";

import { ClaudeCodeVersionStatus } from "@repo/api/src/types/agent-fleet";
import type { OrgCaseTimeStats } from "@repo/api/src/types/org-stats";
import {
  summarizeAgentFleet,
  useAgentFleet,
} from "@repo/app/compute/hooks/use-agent-fleet";
import { formatActiveTime } from "@repo/app/shared/lib/format-active-time";
import { Link } from "@repo/navigation/link";
import { useOrgPath } from "@repo/navigation/use-org-path";
import { useState } from "react";
import {
  useOrgCaseStats,
  useOrgProjectStats,
  useOrgSessionStats,
  useOrgWorkflowStats,
} from "../hooks/use-org-stats";
import { HomeStatCard, StatValue } from "./home-stat-card";

const CASE_RANGE_LABELS = { 7: "7 days", 30: "30 days" } as const;
type CaseRange = keyof typeof CASE_RANGE_LABELS;
const CASE_RANGES: CaseRange[] = [7, 30];
const DEFAULT_CASE_RANGE: CaseRange = 30;

export function ProjectsWidget() {
  const query = useOrgProjectStats();
  return (
    <HomeStatCard
      footer={<WidgetLink href="/projects" label="View projects" />}
      query={query}
      title="Projects"
    >
      {(data) => (
        <div className="grid grid-cols-2 gap-3">
          <StatValue label="Total" value={data.total} />
          <StatValue label="Active in 7 days" value={data.active7d} />
        </div>
      )}
    </HomeStatCard>
  );
}

export function WorkflowsWidget() {
  const query = useOrgWorkflowStats();
  return (
    <HomeStatCard
      footer={<WidgetLink href="/workflows" label="View workflows" />}
      query={query}
      title="Workflows"
    >
      {(data) => (
        <div className="grid grid-cols-2 gap-3">
          <StatValue label="Total" value={data.total} />
          <StatValue label="Orchestrated" value={data.orchestrated} />
          <StatValue label="Process" value={data.process} />
          <StatValue label="Enabled" value={data.enabled} />
          <StatValue label="Disabled" value={data.disabled} />
        </div>
      )}
    </HomeStatCard>
  );
}

export function CasesWidget() {
  const query = useOrgCaseStats();
  return (
    <HomeStatCard
      emptyText="No cases yet"
      footer={<WidgetLink href="/cases" label="View cases" />}
      isEmpty={(data) =>
        data.open === 0 && data.closed30d === 0 && data.closed7d === 0
      }
      query={query}
      title="Cases"
    >
      {(data) => (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatValue label="Open" value={data.open} />
            <StatValue
              label="Waiting for a person"
              value={data.waitingForHuman}
            />
            <StatValue
              label="With blocked or failed tasks"
              value={data.withBlockedOrFailedTasks}
            />
            <StatValue label="Closed in 7 days" value={data.closed7d} />
            <StatValue label="Closed in 30 days" value={data.closed30d} />
          </div>
          <ActiveTimeBlock time7d={data.time7d} time30d={data.time30d} />
        </>
      )}
    </HomeStatCard>
  );
}

export function SessionsWidget() {
  const query = useOrgSessionStats();
  return (
    <HomeStatCard
      footer={<WidgetLink href="/sessions" label="View sessions" />}
      query={query}
      title="Sessions"
    >
      {(data) => (
        <div className="grid grid-cols-2 gap-3">
          <StatValue label="Last 7 days" value={data.last7d} />
          <StatValue label="Last 30 days" value={data.last30d} />
        </div>
      )}
    </HomeStatCard>
  );
}

export function AgentsWidget() {
  const query = useAgentFleet();
  return (
    <HomeStatCard
      emptyText="No agents yet"
      footer={<WidgetLink href="/agents" label="View agents" />}
      isEmpty={(data) => data.agents.length === 0}
      query={query}
      title="Agents"
    >
      {(data) => {
        const summary = summarizeAgentFleet(data.agents);
        return (
          <div className="grid grid-cols-2 gap-3">
            <StatValue label="Online" value={summary.online} />
            <StatValue label="Offline" value={summary.offline} />
            <StatValue label="Automatic" value={summary.automatic} />
            <StatValue label="Personal" value={summary.personal} />
            <div
              className={
                summary.versionMismatches > 0
                  ? "text-warning-foreground"
                  : undefined
              }
              data-mismatch={
                summary.versionMismatches > 0
                  ? ClaudeCodeVersionStatus.Mismatch
                  : undefined
              }
            >
              <StatValue
                label="Claude Code version mismatches"
                value={summary.versionMismatches}
              />
            </div>
          </div>
        );
      }}
    </HomeStatCard>
  );
}

function ActiveTimeBlock({
  time7d,
  time30d,
}: Readonly<{ time7d: OrgCaseTimeStats; time30d: OrgCaseTimeStats }>) {
  const [range, setRange] = useState<CaseRange>(DEFAULT_CASE_RANGE);
  const time = range === 7 ? time7d : time30d;

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">Active agent time</span>
        <div className="flex gap-1">
          {CASE_RANGES.map((value) => (
            <button
              aria-pressed={value === range}
              className={
                value === range
                  ? "rounded bg-accent px-2 py-0.5 text-xs"
                  : "rounded px-2 py-0.5 text-muted-foreground text-xs"
              }
              key={value}
              onClick={() => setRange(value)}
              type="button"
            >
              {value === 7 ? "7d" : "30d"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatValue
          format={formatActiveTime}
          label="Median active time"
          value={time.medianActiveMs}
        />
        <StatValue
          format={formatActiveTime}
          label="Total active time"
          value={time.totalActiveMs}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Based on {time.sampleSize} closed{" "}
        {time.sampleSize === 1 ? "case" : "cases"} in the last{" "}
        {CASE_RANGE_LABELS[range]}
      </p>
      <p className="text-muted-foreground text-xs" data-testid="median-elapsed">
        Median elapsed (opened → closed):{" "}
        {formatActiveTime(time.medianElapsedMs)}
      </p>
    </div>
  );
}

function WidgetLink({
  href,
  label,
}: Readonly<{ href: string; label: string }>) {
  const buildOrgPath = useOrgPath();
  return (
    <Link
      className="text-muted-foreground text-xs underline-offset-2 hover:underline"
      href={buildOrgPath(href)}
    >
      {label}
    </Link>
  );
}
