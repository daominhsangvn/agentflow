import type { ApiResult } from "@repo/api/src/types/common";
import { NextResponse } from "next/server";
import { z } from "zod";
import { orchestratorCaseService } from "@/app/orchestrator/cases/service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  badRequestResponse,
  errorResponse,
  notFoundResponse,
  parseQueryParams,
} from "@/lib/route-utils";

const idSchema = z.uuid();
const querySchema = z.object({ name: z.string().trim().min(1).max(500) });
const NON_ASCII_RE = /[^\x20-\x7E]|["\\]/g;

/**
 * GET /orchestrator/cases/{id}/tasks/{taskId}/file?name=
 * The bytes of a file a task collected, always as an attachment. Any org member.
 */
export const GET = withAnyAuth<
  never,
  "/orchestrator/cases/[id]/tasks/[taskId]/file"
>(async ({ user }, request, params) => {
  try {
    const { id, taskId } = await params;
    if (
      !(idSchema.safeParse(id).success && idSchema.safeParse(taskId).success)
    ) {
      return badRequestResponse("Invalid case or task id");
    }
    const { params: query, errorResponse: invalid } = parseQueryParams(
      request,
      querySchema
    );
    if (invalid) {
      return invalid;
    }
    const file = await orchestratorCaseService.readTaskFile(
      user.organizationId,
      id,
      taskId,
      query.name
    );
    if (!file) {
      return notFoundResponse("File");
    }
    const ascii = file.fileName.replaceAll(NON_ASCII_RE, "_");
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    }) as NextResponse<ApiResult<never>>;
  } catch (error) {
    return errorResponse("Failed to read the task file", error);
  }
});
