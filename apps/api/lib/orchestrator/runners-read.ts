/**
 * What a conversation has read through runners_list: the contentHash of each runner's
 * AGENTFLOW.md (by computeTargetId), stored in orchestrator_conversations.runners_read as
 * `{ turnId, hashes }`. task_run is refused until the conversation read the runner's current
 * file. The value is cleared when the conversation's Claude session is reset or replaced.
 */

import type { ComputeTargetCapabilities } from "@repo/api/src/types/runner-capabilities";
import { Prisma, withDb } from "@repo/database";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import { z } from "zod";
import { stringRecordSchema } from "@/lib/json-schema";

/** computeTargetId -> contentHash. */
export type RunnersRead = Record<string, string>;

const runnersReadRecordSchema = z.object({
  turnId: z.string(),
  hashes: stringRecordSchema,
});

/** Overwrites the conversation's record with the files this runners_list returned. */
export function recordRunnersRead(input: {
  organizationId: string;
  projectId: string;
  conversationId: string;
  turnId: string;
  files: ComputeTargetCapabilities[];
}): Promise<RunnersRead> {
  const { organizationId, projectId, conversationId, turnId, files } = input;
  return withSpan(
    "orchestrator.record_runners_read",
    {
      [AfAttribute.OrgId]: organizationId,
      [AfAttribute.ProjectId]: projectId,
      [AfAttribute.ConversationId]: conversationId,
      [AfAttribute.TurnId]: turnId,
    },
    async (span) => {
      const hashes: RunnersRead = Object.fromEntries(
        files.map((f) => [f.computeTargetId, f.contentHash])
      );
      const { count } = await withDb((db) =>
        db.orchestratorConversation.updateMany({
          where: { id: conversationId, organizationId },
          data: { runnersRead: { turnId, hashes } },
        })
      );
      if (count === 0) {
        setSpanOutcome(AfOutcome.Error, "conversation_not_found", span);
        log.warn("orchestrator.runners_read_failed", {
          reason: "conversation_not_found",
          organizationId,
          conversationId,
        });
        return hashes;
      }
      log.debug("orchestrator.runners_read", {
        conversationId,
        runners: files.length,
      });
      return hashes;
    }
  );
}

/** The hashes the conversation last read, or null (fail closed) when none or malformed. */
export async function loadRunnersRead(
  organizationId: string,
  conversationId: string
): Promise<RunnersRead | null> {
  const row = await withDb((db) =>
    db.orchestratorConversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { runnersRead: true },
    })
  );
  const parsed = runnersReadRecordSchema.safeParse(row?.runnersRead);
  return parsed.success ? parsed.data.hashes : null;
}

/** True when the stored record was written by the given turn's runners_list. */
export function runnersReadWrittenBy(stored: unknown, turnId: string): boolean {
  const parsed = runnersReadRecordSchema.safeParse(stored);
  return parsed.success && parsed.data.turnId === turnId;
}

/**
 * Clears the record so the next task_run needs runners_list. Inside a `withDb.tx` it joins that
 * transaction.
 */
export async function clearRunnersRead(
  organizationId: string,
  conversationId: string
): Promise<void> {
  await withDb((db) =>
    db.orchestratorConversation.updateMany({
      where: { id: conversationId, organizationId },
      data: { runnersRead: Prisma.DbNull },
    })
  );
}
