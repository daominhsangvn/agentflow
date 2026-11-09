import type { WorkflowAgentMap } from "@repo/api/src/types/orchestrator";
import { orchestratorCaseService } from "@/app/orchestrator/cases/service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  errorResponse,
  notFoundResponse,
  successResponse,
} from "@/lib/route-utils";

/**
 * GET /workflows/{id}/agents
 * The workflow's orchestrator and its project's agents (the Agents tab
 * diagram). Any org member.
 */
export const GET = withAnyAuth<WorkflowAgentMap, "/workflows/[id]/agents">(
  async ({ user }, _request, params) => {
    try {
      const { id } = await params;
      const map = await orchestratorCaseService.agentMapForWorkflow(
        user.organizationId,
        id
      );
      if (!map) {
        return notFoundResponse("Workflow");
      }
      return successResponse(map);
    } catch (error) {
      return errorResponse("Failed to load the workflow's agents", error);
    }
  }
);
