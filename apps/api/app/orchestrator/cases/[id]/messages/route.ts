import { failure } from "@repo/api/src/types/common";
import {
  type OrchestratorCaseMessagePosted,
  postOrchestratorCaseMessageInputSchema,
} from "@repo/api/src/types/orchestrator";
import { Status } from "@repo/api/src/types/result";
import { NextResponse } from "next/server";
import { orchestratorCaseService } from "@/app/orchestrator/cases/service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  errorResponse,
  notFoundResponse,
  parseBody,
  successResponse,
} from "@/lib/route-utils";

const BODY_MAX_BYTES = 64 * 1024;

/**
 * POST /orchestrator/cases/{id}/messages
 * A member writes to the case's orchestrator, optionally answering the
 * questions of its tasks (`{ conversationId, text, answers, toAgentId? }`);
 * `toAgentId` addresses an agent with a task in the case. Any org member.
 */
export const POST = withAnyAuth<
  OrchestratorCaseMessagePosted,
  "/orchestrator/cases/[id]/messages"
>(async (auth, request, params) => {
  try {
    const { id } = await params;
    const { body, errorResponse: invalid } = await parseBody(
      request,
      postOrchestratorCaseMessageInputSchema,
      { maxBytes: BODY_MAX_BYTES }
    );
    if (invalid || !body) {
      return invalid;
    }
    const result = await orchestratorCaseService.postMessage(
      auth.user.organizationId,
      auth.user.id,
      id,
      body
    );
    if (result.ok) {
      return successResponse(result.value);
    }
    if (result.error === Status.NotFound) {
      return notFoundResponse("Conversation");
    }
    let message = "Forbidden";
    if (result.error === Status.BadRequest) {
      message = "An answer does not match a question of the case";
    } else if (result.error === Status.Conflict) {
      message = "The agent has no task in this case";
    }
    return NextResponse.json(failure(message), { status: result.error });
  } catch (error) {
    return errorResponse("Failed to post the message", error);
  }
});
