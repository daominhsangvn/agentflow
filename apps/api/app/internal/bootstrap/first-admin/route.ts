import { z } from "zod";
import { validateInternalSecret } from "@/lib/internal-auth";
import {
  errorResponse,
  parseBody,
  successResponse,
  unauthorizedResponse,
} from "@/lib/route-utils";
import { firstAdminBootstrapService } from "./service";

const firstAdminValidator = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  if (!validateInternalSecret(request)) {
    return unauthorizedResponse();
  }
  const { body, errorResponse: invalid } = await parseBody(
    request,
    firstAdminValidator
  );
  if (invalid) {
    return invalid;
  }
  const result = await firstAdminBootstrapService.ensureFirstAdmin(body);
  if (!result.ok) {
    return errorResponse(
      "Failed to bootstrap the first admin",
      null,
      result.error
    );
  }
  return successResponse(result.value);
}
