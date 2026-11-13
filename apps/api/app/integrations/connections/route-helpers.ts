import type { ApiResult } from "@repo/api/src/types/common";
import { failure } from "@repo/api/src/types/common";
import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { NextResponse } from "next/server";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
import { hasOrgPermission } from "@/lib/auth/org-permissions";
import type { AuthContext } from "@/lib/auth/with-auth";
import type { ConfigViewer } from "@/lib/integrations/connection/url-redaction";
import type { ConnectionServiceError } from "@/lib/integrations/connection-service";
import { parseJsonObject } from "@/lib/json-schema";

/**
 * Shared by the /integrations/connections routes. Everything about
 * connections is admin-only: reads, changes, the connection test (Teams
 * posts a test card) and the inbound secret.
 */

/** Upper bound for connection create/update bodies (secrets are ≤ 8 KiB each). */
export const CONNECTION_BODY_MAX_BYTES = 256 * 1024;

/** Returns a 403 response unless the caller may manage integrations. */
export function denyUnlessIntegrationManager(
  auth: Pick<AuthContext, "clerkOrgId" | "clerkUserId">,
  request: { method: string; route: string }
): Promise<NextResponse<ApiResult<never>> | null> {
  return denyUnlessPermitted(auth, request, OrgPermission.IntegrationManage);
}

/**
 * Who reads connection config embedded elsewhere (workflow triggers and
 * actions). Members who are not org admins get url-kind config fields as
 * their origin only (they may embed a token).
 */
export async function resolveConfigViewer(
  auth: Pick<AuthContext, "clerkOrgId" | "clerkUserId">
): Promise<ConfigViewer> {
  const isAdmin = await hasOrgPermission(
    auth.clerkOrgId,
    auth.clerkUserId,
    OrgPermission.IntegrationManage
  );
  return { isAdmin };
}

/** Maps a connection service error to its HTTP status with the service message. */
export function connectionErrorResponse(
  error: ConnectionServiceError
): NextResponse<ApiResult<never>> {
  return NextResponse.json(failure(error.message), { status: error.status });
}

/**
 * Keeps only the fields the client actually sent. zod 4 `.partial()` keeps
 * inner `.default()`s, so updateIntegrationConnectionInputSchema fills an
 * omitted config / secrets / deliveryMode / pollIntervalSeconds with the
 * create defaults ({} / {} / "none" / 120). Passed through, a PATCH of only
 * `status` would re-validate an empty config and switch inbound delivery off.
 */
export function keepSubmittedFields<T extends object>(
  parsed: T,
  rawBody: unknown
): Partial<T> {
  const submitted = parseJsonObject(rawBody) ?? {};
  const kept: Partial<T> = {};
  for (const key of Object.keys(parsed) as Array<keyof T>) {
    if (Object.hasOwn(submitted, key)) {
      kept[key] = parsed[key];
    }
  }
  return kept;
}
