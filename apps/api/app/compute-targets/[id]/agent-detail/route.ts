import type { AgentDetail } from "@repo/api/src/types/agent-fleet";
import { z } from "zod";
import { agentDetailService } from "@/app/compute-targets/agent-detail-service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  errorResponse,
  notFoundResponse,
  successResponse,
} from "@/lib/route-utils";

/**
 * GET /compute-targets/:id/agent-detail
 * Health, capabilities, workflows, recent work and usage of one agent of the
 * organization. Any org member.
 */
export const GET = withAnyAuth<
  AgentDetail,
  "/compute-targets/[id]/agent-detail"
>(async ({ user }, _request, params) => {
  try {
    const parsed = z.uuid().safeParse((await params).id);
    if (!parsed.success) {
      return notFoundResponse("Agent");
    }
    const id = parsed.data;
    const detail = await agentDetailService.get(user.organizationId, id);
    return detail ? successResponse(detail) : notFoundResponse("Agent");
  } catch (error) {
    return errorResponse("Failed to load the agent", error);
  }
});
