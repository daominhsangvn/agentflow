import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { auth } from "@repo/auth/server";

/**
 * Whether the signed-in member holds the given workflow permission. Defaults to
 * `WorkflowManage` (edit workflows); run pages pass `WorkflowRunOperate`.
 * Members without it still read workflows and their runs.
 */
export async function resolveWorkflowAdmin(
  permission: OrgPermission = OrgPermission.WorkflowManage
): Promise<boolean> {
  const { has } = await auth();
  return has({ permission });
}
