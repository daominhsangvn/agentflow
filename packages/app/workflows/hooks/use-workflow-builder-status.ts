"use client";

import {
  WORKFLOW_BUILDER_STATUS_PATH,
  type WorkflowBuilderStatus,
} from "@repo/api/src/types/workflow-builder";
import { useApiClient } from "@repo/app/shared/api/use-api-client";
import { useQuery } from "@tanstack/react-query";
import { workflowKeys } from "./workflow-keys";

const BUILDER_STATUS_STALE_TIME_MS = 5 * 60_000;

/** Whether the server has the optional workflow builder assistant switched on. */
export function useWorkflowBuilderStatus({
  enabled,
}: Readonly<{ enabled: boolean }>) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: workflowKeys.builderStatus(),
    queryFn: () =>
      apiClient.get<WorkflowBuilderStatus>(WORKFLOW_BUILDER_STATUS_PATH),
    enabled,
    staleTime: BUILDER_STATUS_STALE_TIME_MS,
  });
}
