import type {
  RegisterComputeTargetInput,
  RegisterComputeTargetResponse,
} from "@repo/api/src/types/compute-target";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  badRequestResponse,
  conflictResponse,
  errorResponse,
  parseBody,
  successResponse,
} from "@/lib/route-utils";
import { checkPersonalAgentProject } from "../personal-agent-project";
import {
  computeTargetsService,
  isComputeTargetGatewayConflictResult,
} from "../service";
import { registerComputeTargetValidator } from "../validators";

/**
 * POST /compute-targets/register
 * Registers or updates a compute target for the authenticated user.
 */
export const POST = withAnyAuth<
  RegisterComputeTargetResponse,
  "/compute-targets/register"
>(async ({ user }, request) => {
  try {
    const { body, errorResponse: parseError } = await parseBody(
      request,
      registerComputeTargetValidator
    );

    if (parseError || !body) {
      return parseError;
    }

    const project = await checkPersonalAgentProject(
      user.organizationId,
      body.capabilities
    );
    if (!project.ok) {
      return badRequestResponse(project.error);
    }

    const target = await computeTargetsService.register(
      user.organizationId,
      user.id,
      body as RegisterComputeTargetInput
    );

    if (isComputeTargetGatewayConflictResult(target)) {
      return conflictResponse(
        "Desktop gateway identity is already bound to another target"
      );
    }

    return successResponse({
      id: target.value.id,
      machineName: target.value.machineName,
      isOnline: true,
    });
  } catch (error) {
    return errorResponse("Failed to register compute target", error);
  }
});
