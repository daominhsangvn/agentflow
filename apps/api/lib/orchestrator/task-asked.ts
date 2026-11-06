import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
import { getPrismaErrorCode } from "@/lib/db-utils";
import { askedOnItem, askedQuestionsText } from "./asked-questions";
import { readChannel } from "./channel";
import type { TaskQuestion } from "./task-result";

/**
 * Records the questions a task's agent asked on the source item itself
 * (questions.json commentId; docs/orchestrator.md): one anchor per comment, so
 * a reply routes to the conversation, and a `task_asked` message as the Case's
 * record. Fail-open: the task result is already stored.
 */

const PRISMA_UNIQUE_VIOLATION = "P2002";

export async function recordAskedQuestions(
  taskId: string,
  questions: TaskQuestion[]
): Promise<void> {
  const asked = askedOnItem(questions);
  if (asked.length === 0) {
    return;
  }
  try {
    await writeAskedQuestions(taskId, asked);
  } catch (error) {
    log.warn("[orchestrator/task-asked] could not record asked questions", {
      taskId,
      error,
    });
  }
}

async function writeAskedQuestions(
  taskId: string,
  asked: Array<TaskQuestion & { commentId: string }>
): Promise<void> {
  const task = await withDb((db) =>
    db.orchestratorTask.findUnique({
      where: { id: taskId },
      select: {
        organizationId: true,
        conversationId: true,
        command: true,
        args: true,
        computeTarget: { select: { machineName: true } },
        conversation: { select: { channel: true } },
      },
    })
  );
  if (!task) {
    return;
  }
  const { organizationId, conversationId } = task;
  const channel = readChannel(task.conversation.channel);
  if (channel) {
    await withDb((db) =>
      db.orchestratorAnchor.createMany({
        data: asked.map((q) => ({
          organizationId,
          conversationId,
          provider: channel.item.provider,
          externalRef: q.commentId,
          taskId,
          questionId: q.id,
        })),
        skipDuplicates: true,
      })
    );
  }
  const text = askedQuestionsText({
    taskId,
    command: [task.command, task.args].filter(Boolean).join(" "),
    runnerName: task.computeTarget?.machineName ?? null,
    itemKey: channel?.item.key ?? null,
    questions: asked,
  });
  try {
    await withDb((db) =>
      db.orchestratorMessage.create({
        data: {
          organizationId,
          conversationId,
          origin: OrchestratorMessageOrigin.Internal,
          kind: OrchestratorMessageKind.TaskAsked,
          actor: null,
          text,
          externalRef: null,
          dedupKey: `task-asked:${taskId}`,
          turnId: null,
          payload: {
            taskId,
            questions: asked.map((q) => ({
              questionId: q.id,
              commentId: q.commentId,
            })),
          },
        },
      })
    );
  } catch (error) {
    if (getPrismaErrorCode(error) !== PRISMA_UNIQUE_VIOLATION) {
      throw error;
    }
  }
}
