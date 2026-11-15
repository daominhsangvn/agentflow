import type { LoopRunnerClaims } from "@repo/auth/loop-runner-jwt";
import { AfAttribute } from "@repo/observability/af-attributes";
import { setActiveSpanAttributes } from "@repo/observability/span";
import type { AuthContext } from "./with-auth";

/** Tag the active request span with the authenticated user, org and method. */
export function annotateAuthSpan(context: AuthContext): void {
  setActiveSpanAttributes({
    [AfAttribute.UserId]: context.user.id,
    [AfAttribute.OrgId]: context.user.organizationId,
    [AfAttribute.AuthMethod]: context.authMethod,
  });
}

/** Tag the active request span with the org and loop of a verified runner token. */
export function annotateLoopRunnerSpan(claims: LoopRunnerClaims): void {
  setActiveSpanAttributes({
    [AfAttribute.OrgId]: claims.organizationId,
    [AfAttribute.LoopId]: claims.loopId,
  });
}
