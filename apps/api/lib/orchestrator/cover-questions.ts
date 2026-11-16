import type { TransactionClient } from "@repo/database";
import { z } from "zod";

/**
 * Counts the requested questions of a task that no earlier message of the
 * conversation answered, and takes that many off the task's open questions.
 * Returns the count subtracted.
 */
export async function coverTaskQuestions(
  tx: TransactionClient,
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    taskId: string;
    questionIds: string[];
  }
): Promise<number> {
  const prior = await tx.orchestratorMessage.findMany({
    where: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      id: { not: input.messageId },
      payload: { path: ["taskId"], equals: input.taskId },
    },
    select: { payload: true },
  });
  const answered = new Set<string>();
  for (const message of prior) {
    const parsed = answeredPayloadSchema.safeParse(message.payload);
    if (parsed.success) {
      for (const id of [
        ...(parsed.data.questionId ? [parsed.data.questionId] : []),
        ...(parsed.data.questionIds ?? []),
      ]) {
        answered.add(id);
      }
    }
  }
  const count = new Set(input.questionIds.filter((id) => !answered.has(id)))
    .size;
  if (count === 0) {
    return 0;
  }
  const where = { id: input.taskId, organizationId: input.organizationId };
  const full = await tx.orchestratorTask.updateMany({
    where: { ...where, openQuestionCount: { gte: count } },
    data: { openQuestionCount: { decrement: count } },
  });
  if (full.count === 0) {
    await tx.orchestratorTask.updateMany({
      where: { ...where, openQuestionCount: { gt: 0 } },
      data: { openQuestionCount: 0 },
    });
  }
  return count;
}

const answeredPayloadSchema = z.object({
  questionId: z.string().optional(),
  questionIds: z.array(z.string()).optional(),
});
