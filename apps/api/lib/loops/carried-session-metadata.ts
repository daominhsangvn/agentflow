import { LoopCommand } from "@repo/api/src/types/loop";
import {
  WorkflowSessionCarryAttempt,
  WorkflowSessionCarryReason,
} from "@repo/api/src/types/workflow-same-item";
import { z } from "zod";
import { parseJsonObject } from "@/lib/json-schema";

/**
 * Loop metadata of the STEP loops of a workflow run that continues the agent
 * session of an earlier run of the same item (docs/workflows.md "Item queue").
 *
 * - `carriedSession`: written on the run's attempt loops only (plain resume,
 *   fork, or the fresh fallback): which run's session was tried and how.
 * - `carriedWorkspace`: written on every loop of a carried run on an auto
 *   runner: the earlier run's folder slug, so `--resume` runs from the same
 *   working directory.
 */

export const CARRIED_SESSION_METADATA_KEY = "carriedSession";
export const CARRIED_WORKSPACE_METADATA_KEY = "carriedWorkspace";

const carriedSessionSchema = z.object({
  fromRunId: z.string().nullable(),
  attempt: z.enum(WorkflowSessionCarryAttempt),
  depth: z.number().int().min(0),
  reason: z.enum(WorkflowSessionCarryReason).nullable(),
});
export type CarriedSessionMetadata = z.infer<typeof carriedSessionSchema>;

const carriedWorkspaceSchema = z.object({
  slug: z.string().min(1).max(255),
  fromRunId: z.string(),
});
export type CarriedWorkspaceMetadata = z.infer<typeof carriedWorkspaceSchema>;

/** A workflow run's loop: it has a run id and never an orchestrator task id. */
const workflowStepLoopSchema = z.looseObject({
  workflowRunId: z.string(),
  orchestratorTaskId: z.undefined(),
});

export function readCarriedSessionMetadata(
  metadata: unknown
): CarriedSessionMetadata | null {
  const parsed = carriedSessionSchema.safeParse(
    parseJsonObject(metadata)?.[CARRIED_SESSION_METADATA_KEY]
  );
  return parsed.success ? parsed.data : null;
}

export function readCarriedWorkspaceMetadata(
  metadata: unknown
): CarriedWorkspaceMetadata | null {
  const parsed = carriedWorkspaceSchema.safeParse(
    parseJsonObject(metadata)?.[CARRIED_WORKSPACE_METADATA_KEY]
  );
  return parsed.success ? parsed.data : null;
}

/**
 * The carried folder slug of a workflow STEP loop, else null. A loop of an
 * orchestrator case task (it has `orchestratorTaskId`) never carries one, even
 * with the key forged into its metadata.
 */
export function carriedWorkspaceSlug(loop: {
  command: string;
  metadata: unknown;
}): string | null {
  if (loop.command !== LoopCommand.Step) {
    return null;
  }
  const guard = workflowStepLoopSchema.safeParse(loop.metadata);
  if (!guard.success) {
    return null;
  }
  return readCarriedWorkspaceMetadata(loop.metadata)?.slug ?? null;
}
