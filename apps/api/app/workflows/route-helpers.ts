import type { ApiResult } from "@repo/api/src/types/common";
import { failure } from "@repo/api/src/types/common";
import type { OrgPermission } from "@repo/api/src/types/org-permissions";
import type { StatusCode } from "@repo/api/src/types/result";
import { workflowRunStatusSchema } from "@repo/api/src/types/workflow";
import { WORKFLOW_EVENT_LIST_MAX_LIMIT } from "@repo/api/src/types/workflow-event";
import { NextResponse } from "next/server";
import { z } from "zod";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
import type { AuthContext } from "@/lib/auth/with-auth";
import { RUN_LIST_MAX_LIMIT } from "@/lib/workflows/run-service";

/**
 * Shared by the /workflows and /workflow-runs routes. Reads are open to every
 * org member; changes, manual runs, cancel and retry need the workflow permissions
 * (workflows spend desktop compute and post to external systems).
 */

/** Upper bound for workflow save bodies (instructions are ≤ 8 KB). */
export const WORKFLOW_BODY_MAX_BYTES = 256 * 1024;
/** Manual run input is ≤ 64 KiB of text. */
export const MANUAL_RUN_BODY_MAX_BYTES = 128 * 1024;

/** ?cursor=&limit=&status= of the run history endpoints. Unknown keys are rejected. */
export const runListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(RUN_LIST_MAX_LIMIT).optional(),
    status: workflowRunStatusSchema.optional(),
  })
  .strict();

/** /workflow-runs adds project and workflow filters to the shared run list query. */
export const orgRunListQuerySchema = runListQuerySchema
  .extend({
    projectId: z.uuid().optional(),
    workflowId: z.uuid().optional(),
  })
  .strict();

/** Returns a 403 response when the caller lacks `permission`, or null when permitted. */
export function denyUnlessWorkflowPermission(
  auth: Pick<AuthContext, "clerkOrgId" | "clerkUserId">,
  request: { method: string; route: string },
  permission: OrgPermission
): Promise<NextResponse<ApiResult<never>> | null> {
  return denyUnlessPermitted(auth, request, permission);
}

/** Maps a workflow/run service error to its HTTP status with the service message. */
export function serviceErrorResponse(error: {
  status: StatusCode;
  message: string;
}): NextResponse<ApiResult<never>> {
  return NextResponse.json(failure(error.message), { status: error.status });
}

/** ?cursor=&limit= of the workflow events endpoint. Unknown keys are rejected. */
export const eventListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(WORKFLOW_EVENT_LIST_MAX_LIMIT)
      .optional(),
  })
  .strict();
