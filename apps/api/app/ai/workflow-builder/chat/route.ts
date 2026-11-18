import "server-only";

import { WORKFLOW_BUILDER_CHAT_BODY_MAX_BYTES } from "@repo/api/src/types/workflow-builder";
import { workflowBuilderChatRequestSchema } from "@repo/api/src/types/workflow-builder-schemas";
import { log } from "@repo/observability/log";
import { parseBody, scheduleLogFlush } from "@/lib/route-utils";
import {
  authorizeWorkflowBuilderChat,
  toChatFailureResponse,
} from "../route-helpers";
import { workflowBuilderService } from "../service";

/**
 * Route time budget (seconds); stays above `WORKFLOW_BUILDER_REQUEST_TIMEOUT_MS` in
 * `service/chat-run.ts` (the CLI wall clock) so the run is killed first.
 */
export const maxDuration = 300;

export const POST = async (request: Request): Promise<Response> => {
  try {
    const authorization = await authorizeWorkflowBuilderChat(request);
    if (!authorization.ok) {
      return authorization.response;
    }

    const parsed = await parseBody(request, workflowBuilderChatRequestSchema, {
      maxBytes: WORKFLOW_BUILDER_CHAT_BODY_MAX_BYTES,
    });
    if (parsed.errorResponse) {
      return parsed.errorResponse;
    }

    const result = await workflowBuilderService.streamChat({
      caller: authorization.caller,
      messages: parsed.body.messages,
      editorYaml: parsed.body.editorYaml,
      workflowId: parsed.body.workflowId,
      abortSignal: request.signal,
    });
    if (!result.ok) {
      return toChatFailureResponse(result.error);
    }
    return result.value;
  } catch (error) {
    log.error("workflow_builder.chat_route_failed", {
      reason: "route_exception",
      error: error instanceof Error ? { name: error.name } : null,
    });
    scheduleLogFlush();
    return new Response(
      JSON.stringify({ message: "Something went wrong", ok: false }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
