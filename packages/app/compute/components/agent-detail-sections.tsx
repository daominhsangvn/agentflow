"use client";

import {
  type AgentCapabilityFile,
  type AgentDetail,
  AgentKind,
  type AgentRecentWork,
  type AgentUsageWindow,
  AgentWorkflowRole,
  AgentWorkStatus,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import {
  type RunnerCommand,
  RunnerCommandMode,
} from "@repo/api/src/types/runner-capabilities";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import { formatActiveTime } from "@repo/app/shared/lib/format-active-time";
import {
  formatCostPrecise,
  formatTokenCount,
} from "@repo/app/shared/lib/format-utils";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { Link } from "@repo/navigation/link";
import { useOrgPath } from "@repo/navigation/use-org-path";
import type { ReactNode } from "react";

type BadgeVariant = "success" | "error" | "warning" | "secondary" | "info";

const KIND_LABELS: Record<AgentKind, string> = {
  [AgentKind.Automatic]: "Automatic",
  [AgentKind.Personal]: "Personal",
};

const ROLE_LABELS: Record<AgentWorkflowRole, string> = {
  [AgentWorkflowRole.Orchestrator]: "Orchestrator",
  [AgentWorkflowRole.Default]: "Default agent",
  [AgentWorkflowRole.Rule]: "Agent rule",
  [AgentWorkflowRole.ProjectAgent]: "Project agent",
};

const WORK_STATUS_BADGES: Record<
  AgentWorkStatus,
  { label: string; variant: BadgeVariant }
> = {
  [AgentWorkStatus.Queued]: { label: "Queued", variant: "secondary" },
  [AgentWorkStatus.Running]: { label: "Running", variant: "info" },
  [AgentWorkStatus.Succeeded]: { label: "Succeeded", variant: "success" },
  [AgentWorkStatus.Blocked]: { label: "Blocked", variant: "warning" },
  [AgentWorkStatus.Failed]: { label: "Failed", variant: "error" },
  [AgentWorkStatus.Cancelled]: { label: "Cancelled", variant: "secondary" },
};

export function AgentHeaderSection({
  detail,
}: Readonly<{ detail: AgentDetail }>) {
  const { agent } = detail;
  const name = agent.displayName ?? agent.machineName;

  return (
    <Card data-testid="agent-header">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
          {name}
          {agent.displayName ? (
            <span className="font-normal text-muted-foreground text-sm">
              {agent.machineName}
            </span>
          ) : null}
          <Badge variant="outline">{KIND_LABELS[agent.kind]}</Badge>
          {agent.isSharedWithOrg ? (
            <Badge variant="secondary">shared</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {agent.kind === AgentKind.Personal && agent.ownerName ? (
          <div>Owner: {agent.ownerName}</div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={
              agent.isOnline
                ? "size-2 rounded-full bg-success"
                : "size-2 rounded-full bg-muted-foreground"
            }
          />
          {agent.isOnline
            ? "Online"
            : `Offline · last seen ${formatRelativeTime(agent.lastSeen)}`}
        </div>
        <ClaudeCodeLine detail={detail} />
        <HealthBlock detail={detail} />
      </CardContent>
    </Card>
  );
}

function ClaudeCodeLine({ detail }: Readonly<{ detail: AgentDetail }>) {
  const { reported, pinned, status } = detail.agent.claudeCode;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span>
        Claude Code: {reported ?? "-"} reported · {pinned} pinned
      </span>
      {status === ClaudeCodeVersionStatus.Mismatch ? (
        <Badge variant="warning">Version mismatch</Badge>
      ) : null}
    </div>
  );
}

function HealthBlock({ detail }: Readonly<{ detail: AgentDetail }>) {
  const { health } = detail.agent;
  if (!health) {
    return <div className="text-muted-foreground">Not checked yet</div>;
  }
  const missing = detail.healthTools.filter((tool) => !tool.passed);
  const found = detail.healthTools.filter((tool) => tool.passed);

  return (
    <div className="flex flex-col gap-1">
      <div>
        Checked {formatRelativeTime(health.healthChecked)}: {found.length} tools
        found, {missing.length} missing
      </div>
      <ul className="flex flex-wrap gap-1" data-testid="health-missing">
        {missing.map((tool) => (
          <li key={tool.id}>
            <Badge variant={tool.required ? "error" : "warning"}>
              {tool.label}
              {tool.required ? " (required)" : ""}
            </Badge>
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap gap-1 text-xs" data-testid="health-found">
        {found.map((tool) => (
          <li key={tool.id}>
            <Badge variant="secondary">
              {tool.label}
              {tool.version ? ` ${tool.version}` : ""}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CapabilitiesSection({
  capabilities,
}: Readonly<{ capabilities: AgentCapabilityFile[] }>) {
  return (
    <SectionCard title="Capabilities">
      {capabilities.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          This agent has not uploaded an AGENTFLOW.md yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {capabilities.map((file) => (
            <CapabilityFileCard
              file={file}
              key={`${file.projectId}:${file.source}`}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function CapabilityFileCard({ file }: Readonly<{ file: AgentCapabilityFile }>) {
  const notes = [...file.problems, ...file.warnings];
  return (
    <div className="rounded-md border p-3" data-testid="capability-file">
      <div className="mb-2 font-medium text-sm">
        {file.projectName} · {file.roleName ?? file.source}
      </div>
      <ul className="flex flex-col gap-2">
        {file.commands.map((command) => (
          <CommandRow command={command} key={command.name} />
        ))}
      </ul>
      {notes.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-muted-foreground text-xs">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CommandRow({ command }: Readonly<{ command: RunnerCommand }>) {
  return (
    <li className="flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="font-medium">
          {command.name}
          {command.args ? ` ${command.args}` : ""}
        </code>
        <Badge
          variant={
            command.mode === RunnerCommandMode.Write ? "warning" : "secondary"
          }
        >
          {command.mode}
        </Badge>
        {command.needs?.map((need) => (
          <Badge key={need} variant="outline">
            needs {need}
          </Badge>
        ))}
        {command.produces ? (
          <Badge variant="outline">produces {command.produces}</Badge>
        ) : null}
        {command.push ? <Badge variant="outline">pushes</Badge> : null}
        {command.attach?.length ? (
          <Badge variant="outline">attaches {command.attach.join(", ")}</Badge>
        ) : null}
      </div>
      {command.description ? (
        <span className="text-muted-foreground text-xs">
          {command.description}
        </span>
      ) : null}
    </li>
  );
}

export function UsedBySection({ detail }: Readonly<{ detail: AgentDetail }>) {
  const buildOrgPath = useOrgPath();
  const empty = detail.projects.length === 0 && detail.workflows.length === 0;

  return (
    <SectionCard title="Used by">
      {empty ? (
        <p className="text-muted-foreground text-sm">
          No projects or enabled workflows use this agent.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-wrap gap-2">
            {detail.projects.map((project) => (
              <li key={project.id}>
                <Link
                  className="underline underline-offset-2"
                  href={buildOrgPath(`/projects/${project.id}?tab=agents`)}
                >
                  {project.name}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-1">
            {detail.workflows.map((workflow) => (
              <li
                className="flex flex-wrap items-center gap-1.5"
                key={workflow.id}
              >
                <Link
                  className="underline underline-offset-2"
                  href={buildOrgPath(`/workflows/${workflow.id}`)}
                >
                  {workflow.name}
                </Link>
                <span className="text-muted-foreground">
                  {workflow.projectName}
                </span>
                {workflow.roles.map((role) => (
                  <Badge key={role} variant="secondary">
                    {ROLE_LABELS[role]}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

export function RecentTasksSection({
  recentWork,
}: Readonly<{ recentWork: AgentRecentWork[] }>) {
  return (
    <SectionCard title="Recent tasks">
      {recentWork.length === 0 ? (
        <p className="text-muted-foreground text-sm">No tasks yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Work</TableHead>
              <TableHead>Command</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Active time</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentWork.map((work) => (
              <RecentWorkRow key={work.id} work={work} />
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}

function RecentWorkRow({ work }: Readonly<{ work: AgentRecentWork }>) {
  const status = WORK_STATUS_BADGES[work.status];
  return (
    <TableRow>
      <TableCell>
        <WorkLink work={work} />
      </TableCell>
      <TableCell>
        <code>{work.command}</code>
      </TableCell>
      <TableCell>
        <Badge variant={status.variant}>{status.label}</Badge>
      </TableCell>
      <TableCell>{formatActiveTime(work.activeMs)}</TableCell>
      <TableCell>
        {formatTokenCount(work.inputTokens + work.outputTokens)}
      </TableCell>
      <TableCell>{formatCost(work.costUsd)}</TableCell>
      <TableCell>{formatRelativeTime(work.started)}</TableCell>
    </TableRow>
  );
}

function WorkLink({ work }: Readonly<{ work: AgentRecentWork }>) {
  const buildOrgPath = useOrgPath();
  if (work.caseId) {
    return (
      <Link
        className="underline underline-offset-2"
        href={buildOrgPath(`/orchestrator/cases/${work.caseId}`)}
      >
        {work.caseTitle ?? work.label}
      </Link>
    );
  }
  if (work.workflowId && work.runId) {
    return (
      <Link
        className="underline underline-offset-2"
        href={buildOrgPath(`/workflows/${work.workflowId}/runs/${work.runId}`)}
      >
        {work.label}
      </Link>
    );
  }
  return <span>{work.label}</span>;
}

export function UsageSection({
  usage,
}: Readonly<{ usage: AgentDetail["usage"] }>) {
  return (
    <SectionCard title="Usage">
      <div className="grid gap-4 sm:grid-cols-2">
        <UsageColumn title="7 days" window={usage.last7d} />
        <UsageColumn title="30 days" window={usage.last30d} />
      </div>
      <p className="mt-3 text-muted-foreground text-xs">
        All sessions on this agent, including personal sessions, plus
        orchestrator turns.
      </p>
    </SectionCard>
  );
}

function UsageColumn({
  title,
  window: usageWindow,
}: Readonly<{ title: string; window: AgentUsageWindow }>) {
  const rated =
    usageWindow.succeeded + usageWindow.failed + usageWindow.blocked;
  const successRate =
    rated === 0 ? "-" : `${Math.round((usageWindow.succeeded / rated) * 100)}%`;

  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
      data-testid={`usage-${title.replaceAll(" ", "-")}`}
    >
      <dt className="col-span-2 font-medium">{title}</dt>
      <dt className="text-muted-foreground">Tasks</dt>
      <dd>{usageWindow.tasks}</dd>
      <dt className="text-muted-foreground">Success rate</dt>
      <dd>{successRate}</dd>
      <dt className="text-muted-foreground">Active time</dt>
      <dd>{formatActiveTime(usageWindow.activeMs)}</dd>
      <dt className="text-muted-foreground">Tokens in / out</dt>
      <dd>
        {formatTokenCount(usageWindow.inputTokens)} /{" "}
        {formatTokenCount(usageWindow.outputTokens)}
      </dd>
      <dt className="text-muted-foreground">Cost</dt>
      <dd>{formatCost(usageWindow.costUsd)}</dd>
    </dl>
  );
}

function SectionCard({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function formatCost(cost: number | null): string {
  if (cost === null || !Number.isFinite(cost)) {
    return "-";
  }
  return formatCostPrecise(cost);
}
