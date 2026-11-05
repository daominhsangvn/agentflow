"use client";

import { useAgentDetail } from "@repo/app/compute/hooks/use-agent-fleet";
// Cross-slice: the shared inline error state with retry.
import { QueryErrorMessage } from "@repo/app/integrations/components/query-error-message";
import { ApiError } from "@repo/app/shared/api/api-error";
import { ClientRedirect } from "@repo/app/shared/components/client-redirect";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import {
  AgentHeaderSection,
  CapabilitiesSection,
  RecentTasksSection,
  UsageSection,
  UsedBySection,
} from "./agent-detail-sections";

export type AgentDetailViewProps = {
  agentId: string;
  /** Where an id that is not an agent goes (the skills catalog). */
  notFoundHref: string;
};

/** One agent: health, capabilities, who uses it, recent tasks and usage. */
export function AgentDetailView({
  agentId,
  notFoundHref,
}: Readonly<AgentDetailViewProps>) {
  const query = useAgentDetail(agentId);

  if (query.error) {
    if (query.error instanceof ApiError && query.error.isNotFound()) {
      return <ClientRedirect href={notFoundHref} />;
    }
    return (
      <QueryErrorMessage
        error={query.error}
        onRetry={() => {
          query.refetch();
        }}
        title="Couldn't load agent"
      />
    );
  }
  if (query.isLoading || !query.data) {
    return (
      <div aria-label="Loading agent" className="space-y-3" role="status">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const detail = query.data;
  return (
    <div className="flex flex-col gap-4" data-testid="agent-detail">
      <AgentHeaderSection detail={detail} />
      <CapabilitiesSection capabilities={detail.capabilities} />
      <UsedBySection detail={detail} />
      <RecentTasksSection recentWork={detail.recentWork} />
      <UsageSection usage={detail.usage} />
    </div>
  );
}
