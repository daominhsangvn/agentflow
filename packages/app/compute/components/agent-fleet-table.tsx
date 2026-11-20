"use client";

import {
  type AgentFleetEntry,
  AgentKind,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import {
  summarizeAgentFleet,
  useAgentFleet,
} from "@repo/app/compute/hooks/use-agent-fleet";
// Cross-slice: the shared inline error state with retry.
import { QueryErrorMessage } from "@repo/app/integrations/components/query-error-message";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { EmptyState } from "@repo/design-system/components/ui/empty-state";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
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
import { BotIcon } from "lucide-react";

const KIND_LABELS: Record<AgentKind, string> = {
  [AgentKind.Automatic]: "Automatic",
  [AgentKind.Personal]: "Personal",
};

/** Every agent (compute target) of the organization, with its health and commands. */
export function AgentFleetTable() {
  const query = useAgentFleet();

  if (query.error) {
    return (
      <QueryErrorMessage
        error={query.error}
        onRetry={() => {
          query.refetch();
        }}
        title="Couldn't load agents"
      />
    );
  }
  if (query.isLoading || !query.data) {
    return (
      <div aria-label="Loading agents" className="space-y-2" role="status">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (query.data.agents.length === 0) {
    return <EmptyFleet />;
  }

  const { agents } = query.data;
  return (
    <div className="flex flex-col gap-4" data-testid="agent-fleet">
      <FleetSummary agents={agents} />
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Claude Code</TableHead>
              <TableHead>Commands</TableHead>
              <TableHead>Projects</TableHead>
              <TableHead className="text-right">
                Used by enabled workflows
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => (
              <AgentRow agent={agent} key={agent.id} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function EmptyFleet() {
  const buildOrgPath = useOrgPath();
  return (
    <EmptyState
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={buildOrgPath("/settings?tab=api-keys")}>
            Create an API key
          </Link>
        </Button>
      }
      description="Start an automatic agent or a personal agent with an API key."
      icon={BotIcon}
      title="No agents yet"
    />
  );
}

function FleetSummary({ agents }: Readonly<{ agents: AgentFleetEntry[] }>) {
  const summary = summarizeAgentFleet(agents);
  return (
    <div className="flex flex-wrap gap-2" data-testid="agent-fleet-summary">
      <Badge variant="success">{summary.online} online</Badge>
      <Badge variant="secondary">{summary.offline} offline</Badge>
      <Badge variant="secondary">{summary.automatic} automatic</Badge>
      <Badge variant="secondary">{summary.personal} personal</Badge>
      <Badge variant={summary.versionMismatches > 0 ? "warning" : "secondary"}>
        {summary.versionMismatches} version mismatches
      </Badge>
    </div>
  );
}

function AgentRow({ agent }: Readonly<{ agent: AgentFleetEntry }>) {
  const buildOrgPath = useOrgPath();
  const name = agent.displayName ?? agent.machineName;

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <Link
            className="font-medium hover:underline"
            href={buildOrgPath(`/agents/${agent.id}`)}
          >
            {name}
          </Link>
          {agent.displayName ? (
            <span className="text-muted-foreground text-xs">
              {agent.machineName}
            </span>
          ) : null}
          <AgentOwner agent={agent} />
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{KIND_LABELS[agent.kind]}</Badge>
      </TableCell>
      <TableCell>
        <AgentStatus agent={agent} />
      </TableCell>
      <TableCell>{healthLabel(agent)}</TableCell>
      <TableCell>
        <ClaudeCodeCell agent={agent} />
      </TableCell>
      <TableCell>
        <CommandsCell agent={agent} />
      </TableCell>
      <TableCell>
        <ProjectLinks agent={agent} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {agent.enabledWorkflowCount}
      </TableCell>
    </TableRow>
  );
}

function AgentOwner({ agent }: Readonly<{ agent: AgentFleetEntry }>) {
  const showOwner = agent.kind === AgentKind.Personal && agent.ownerName;
  if (!(showOwner || agent.isSharedWithOrg)) {
    return null;
  }
  return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs">
      {showOwner ? <span>{agent.ownerName}</span> : null}
      {agent.isSharedWithOrg ? <Badge variant="secondary">shared</Badge> : null}
    </span>
  );
}

function AgentStatus({ agent }: Readonly<{ agent: AgentFleetEntry }>) {
  if (agent.isOnline) {
    return (
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full bg-success" />
        Online
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span aria-hidden className="size-2 rounded-full bg-muted-foreground" />
      Offline · last seen {formatRelativeTime(agent.lastSeen)}
    </span>
  );
}

function healthLabel(agent: AgentFleetEntry): string {
  if (!agent.health) {
    return "Not checked";
  }
  if (agent.health.allRequiredPassed) {
    return "Passed";
  }
  return `${agent.health.requiredFailureCount} required checks failing`;
}

function ClaudeCodeCell({ agent }: Readonly<{ agent: AgentFleetEntry }>) {
  const { reported, pinned, status } = agent.claudeCode;
  if (status === ClaudeCodeVersionStatus.Unknown) {
    return <span>-</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span>{reported ?? "-"}</span>
      {status === ClaudeCodeVersionStatus.Mismatch ? (
        <Badge variant="warning">pinned {pinned}</Badge>
      ) : null}
      {status === ClaudeCodeVersionStatus.Latest ? (
        <span className="text-muted-foreground text-xs">latest</span>
      ) : null}
    </span>
  );
}

function CommandsCell({ agent }: Readonly<{ agent: AgentFleetEntry }>) {
  if (agent.projects.length === 0) {
    return <span>-</span>;
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      {agent.projects.map((project) => (
        <div key={project.id}>
          <span className="font-medium">{project.name}</span>
          {project.commands.length > 0
            ? `: ${project.commands.join(", ")}`
            : null}
          {project.problemCount > 0 ? (
            <Badge className="ml-1" variant="warning">
              {project.problemCount} problems
            </Badge>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ProjectLinks({ agent }: Readonly<{ agent: AgentFleetEntry }>) {
  const buildOrgPath = useOrgPath();
  if (agent.projects.length === 0) {
    return <span>-</span>;
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      {agent.projects.map((project) => (
        <Link
          className="underline-offset-2 hover:underline"
          href={buildOrgPath(`/projects/${project.id}?tab=agents`)}
          key={project.id}
        >
          {project.name}
        </Link>
      ))}
    </div>
  );
}
