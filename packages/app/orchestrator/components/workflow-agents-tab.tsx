"use client";

import { QueryErrorMessage } from "@repo/app/integrations/components/query-error-message";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { useAgentsTabParams } from "../hooks/use-agents-tab-params";
import { useWorkflowAgentCases } from "../hooks/use-orchestrator-cases";
import { useWorkflowAgentMap } from "../hooks/use-workflow-agent-map";
import { casesForNode, ORCHESTRATOR_NODE_ID } from "../lib/agent-counters";
import { AgentCaseList } from "./agent-case-list";
import { AgentCaseThread } from "./agent-case-thread";
import { AgentMap } from "./agent-map";

const ORCHESTRATOR_LABEL = "Orchestrator";

export type WorkflowAgentsTabProps = {
  workflowId: string;
  isAdmin: boolean;
};

/** The workflow's orchestrator and agents as a diagram, with the selected node's cases. */
export function WorkflowAgentsTab({
  workflowId,
  isAdmin,
}: Readonly<WorkflowAgentsTabProps>) {
  const params = useAgentsTabParams();
  const mapQuery = useWorkflowAgentMap(workflowId, { enabled: true });
  const casesQuery = useWorkflowAgentCases(workflowId, { enabled: true });
  const map = mapQuery.data;
  const cases = casesQuery.data ?? [];

  if (mapQuery.error && !map) {
    return (
      <QueryErrorMessage
        error={mapQuery.error}
        onRetry={() => {
          mapQuery.refetch();
        }}
        title="Couldn't load the agents"
      />
    );
  }
  if (!map) {
    return (
      <div
        aria-label="Loading agents"
        className="grid gap-4 lg:grid-cols-2"
        data-testid="workflow-agents-tab"
        role="status"
      >
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const agent = map.agents.find(
    (item) => item.computeTargetId === params.agent
  );
  const nodeId = agent ? agent.computeTargetId : ORCHESTRATOR_NODE_ID;
  const nodeName = agent
    ? agent.name
    : (map.orchestrator?.name ?? ORCHESTRATOR_LABEL);
  const agentNames = Object.fromEntries(
    map.agents.map((item) => [item.computeTargetId, item.name])
  );
  const selectedCase = cases.find((item) => item.id === params.caseId) ?? null;

  return (
    <div
      className="grid gap-4 lg:grid-cols-2"
      data-testid="workflow-agents-tab"
    >
      <AgentMap
        cases={cases}
        map={map}
        onSelect={params.selectAgent}
        selectedCase={selectedCase}
        selectedNodeId={nodeId}
      />
      {params.caseId ? (
        <AgentCaseThread
          caseId={params.caseId}
          isAdmin={isAdmin}
          node={{ id: nodeId, name: nodeName }}
          onBack={() => params.selectCase(null)}
        />
      ) : (
        <AgentCaseList
          agentId={agent ? agent.computeTargetId : null}
          agentNames={agentNames}
          cases={casesForNode(cases, nodeId)}
          isLoading={casesQuery.isLoading}
          nodeLabel={nodeName}
          onSelect={params.selectCase}
        />
      )}
    </div>
  );
}
