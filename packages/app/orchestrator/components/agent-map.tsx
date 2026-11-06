"use client";

import { AgentKind } from "@repo/api/src/types/agent-fleet";
import type {
  OrchestratorCaseListItem,
  WorkflowAgentMap,
  WorkflowAgentMapAgent,
} from "@repo/api/src/types/orchestrator";
import { Badge } from "@repo/design-system/components/ui/badge";
import { cn } from "@repo/design-system/lib/utils";
import {
  agentHasActiveTasks,
  agentHasOpenQuestions,
  agentNeedsCount,
  agentsInCase,
  ORCHESTRATOR_NODE_ID,
  orchestratorNeedsCount,
} from "../lib/agent-counters";
import { edgePath, layoutAgentMap, type Point } from "../lib/agent-map-layout";

type AgentMapProps = {
  map: WorkflowAgentMap;
  cases: OrchestratorCaseListItem[];
  selectedNodeId: string;
  selectedCase: OrchestratorCaseListItem | null;
  onSelect: (nodeId: string) => void;
};

const ROW_HEIGHT_REM = 9;

export function AgentMap({
  map,
  cases,
  selectedNodeId,
  selectedCase,
  onSelect,
}: AgentMapProps) {
  if (map.agents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
        No agents are linked to this workflow yet.
      </div>
    );
  }

  const layout = layoutAgentMap(map.agents.length);
  const involved = selectedCase ? new Set(agentsInCase(selectedCase)) : null;
  const banner = askedBanner(cases, selectedCase);

  return (
    <div className="flex flex-col gap-3" data-testid="agent-map">
      {banner ? (
        <div className="rounded-md border border-warning/30 bg-warning/14 px-3 py-2 text-sm">
          Orchestrator asks: {banner}
        </div>
      ) : null}
      <div
        className="relative w-full"
        style={{ minHeight: `${(layout.rows + 1) * ROW_HEIGHT_REM}rem` }}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0 size-full"
          focusable="false"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          {map.agents.map((agent, index) => (
            <path
              className={edgeClass(cases, agent)}
              d={edgePath(layout.orchestrator, layout.agents[index])}
              data-testid="agent-map-edge"
              fill="none"
              key={agent.computeTargetId}
              strokeDasharray={
                agentHasActiveTasks(cases, agent.computeTargetId)
                  ? "6 6"
                  : undefined
              }
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <OrchestratorNode
          count={orchestratorNeedsCount(cases)}
          map={map}
          onSelect={onSelect}
          point={layout.orchestrator}
          selected={selectedNodeId === ORCHESTRATOR_NODE_ID}
        />
        {map.agents.map((agent, index) => (
          <AgentNode
            agent={agent}
            count={agentNeedsCount(cases, agent.computeTargetId)}
            dimmed={involved !== null && !involved.has(agent.computeTargetId)}
            highlighted={involved?.has(agent.computeTargetId) === true}
            key={agent.computeTargetId}
            onSelect={onSelect}
            point={layout.agents[index]}
            selected={selectedNodeId === agent.computeTargetId}
          />
        ))}
      </div>
    </div>
  );
}

function OrchestratorNode({
  map,
  count,
  point,
  selected,
  onSelect,
}: {
  map: WorkflowAgentMap;
  count: number;
  point: Point;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const name = map.orchestrator?.name ?? "No orchestrator agent";
  const online = map.orchestrator?.isOnline ?? false;
  return (
    <button
      aria-label={buildLabel(name, "orchestrator", online, count)}
      aria-pressed={selected}
      className={cn(
        nodeClass(selected),
        map.orchestrator ? undefined : "text-muted-foreground"
      )}
      onClick={() => onSelect(ORCHESTRATOR_NODE_ID)}
      style={positionStyle(point)}
      type="button"
    >
      <span className="flex items-center gap-1.5">
        <OnlineDot online={online} />
        <span className="truncate font-medium text-sm">{name}</span>
      </span>
      <span className="text-muted-foreground text-xs">Orchestrator</span>
      <CountBadge count={count} />
    </button>
  );
}

function AgentNode({
  agent,
  count,
  point,
  selected,
  dimmed,
  highlighted,
  onSelect,
}: {
  agent: WorkflowAgentMapAgent;
  count: number;
  point: Point;
  selected: boolean;
  dimmed: boolean;
  highlighted: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const kind = kindLabel(agent.kind);
  const role = [agent.role, kind].filter(Boolean).join(" · ");
  return (
    <button
      aria-label={buildLabel(
        agent.name,
        `${kind.toLowerCase()} agent`,
        agent.isOnline,
        count,
        agent.declared
      )}
      aria-pressed={selected}
      className={cn(
        nodeClass(selected),
        dimmed && "opacity-50",
        highlighted && "border-primary",
        !agent.declared && "border-dashed text-muted-foreground"
      )}
      data-dimmed={dimmed}
      onClick={() => onSelect(agent.computeTargetId)}
      style={positionStyle(point)}
      type="button"
    >
      <span className="flex items-center gap-1.5">
        <OnlineDot online={agent.isOnline} />
        <span className="truncate font-medium text-sm">{agent.name}</span>
      </span>
      <span className="text-muted-foreground text-xs">{role}</span>
      {agent.declared ? null : (
        <span className="text-muted-foreground text-xs italic">
          not declared
        </span>
      )}
      <CountBadge count={count} />
    </button>
  );
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        online ? "bg-success" : "bg-muted-foreground/40"
      )}
    />
  );
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <Badge
      className="absolute -top-2 -right-2"
      data-testid="agent-map-count"
      variant="warning"
    >
      {count}
    </Badge>
  );
}

function edgeClass(
  cases: OrchestratorCaseListItem[],
  agent: WorkflowAgentMapAgent
): string {
  if (agentHasOpenQuestions(cases, agent.computeTargetId)) {
    return "stroke-warning";
  }
  if (agentHasActiveTasks(cases, agent.computeTargetId)) {
    return "stroke-primary motion-safe:animate-edge-flow";
  }
  return "stroke-muted-foreground/40";
}

function nodeClass(selected: boolean): string {
  return cn(
    "absolute flex w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-start gap-0.5 rounded-lg border bg-card px-3 py-2 text-left shadow-xs transition-opacity hover:bg-accent",
    selected && "ring-2 ring-primary"
  );
}

function positionStyle(point: Point): { left: string; top: string } {
  return { left: `${point.x}%`, top: `${point.y}%` };
}

function kindLabel(kind: AgentKind): string {
  return kind === AgentKind.Personal ? "Personal" : "Automatic";
}

function buildLabel(
  name: string,
  role: string,
  online: boolean,
  count: number,
  declared = true
): string {
  const parts = [`${name}, ${role}`, online ? "online" : "offline"];
  if (!declared) {
    parts.push("not declared");
  }
  if (count > 0) {
    parts.push(
      `${count} ${count === 1 ? "case needs" : "cases need"} an answer`
    );
  }
  return parts.join(", ");
}

function askedBanner(
  cases: OrchestratorCaseListItem[],
  selectedCase: OrchestratorCaseListItem | null
): string | null {
  if (selectedCase) {
    return selectedCase.askedHuman;
  }
  const newest = cases
    .filter((item) => item.needsPerson && item.askedHuman)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  return newest?.askedHuman ?? null;
}
