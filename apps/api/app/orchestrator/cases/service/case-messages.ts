import { randomUUID } from "node:crypto";
import {
  type OrchestratorCaseMessagePosted,
  OrchestratorCaseStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  type PostOrchestratorCaseMessageInput,
  postOrchestratorCaseMessageInputSchema,
} from "@repo/api/src/types/orchestrator";
import { Result, Status, type StatusCode } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { advanceConversation } from "@/lib/orchestrator/advance";
import { readTaskResult } from "@/lib/orchestrator/task-result";
import { loadOrchestratorWorkflows } from "@/lib/orchestrator/workflow-settings";
import { displayUserName } from "@/lib/user-display-name";
import { waitUntil } from "@/lib/wait-until";

/**
 * A person writes to the orchestrator on the case page, optionally answering
 * the questions a task asked. It is an External message (it wakes a turn after
 * the debounce) marked `via: agentflow`; the answer goes back to the case page.
 */

type Answer = { taskId: string; questionId: string; answer: string };

export async function postCaseMessage(
  organizationId: string,
  userId: string,
  caseId: string,
  input: PostOrchestratorCaseMessageInput
): Promise<Result<OrchestratorCaseMessagePosted, StatusCode>> {
  const parsed = postOrchestratorCaseMessageInputSchema.safeParse(input);
  if (!parsed.success) {
    return Result.err(Status.BadRequest);
  }
  const { conversationId, text, answers, toAgentId } = parsed.data;
  const user = await withDb((db) =>
    db.user.findFirst({
      where: { id: userId, organizationId },
      select: { firstName: true, lastName: true, email: true },
    })
  );
  if (!user) {
    return Result.err(Status.Forbidden);
  }
  const conversation = await withDb((db) =>
    db.orchestratorConversation.findFirst({
      where: { id: conversationId, caseId, organizationId },
      select: { id: true, case: { select: { workflowId: true } } },
    })
  );
  if (!conversation) {
    return Result.err(Status.NotFound);
  }
  const toAgent = toAgentId
    ? await findAddressedAgent(organizationId, caseId, toAgentId)
    : null;
  if (toAgentId && !toAgent) {
    return Result.err(Status.Conflict);
  }
  const questions = await answeredQuestions(organizationId, caseId, answers);
  if (!questions) {
    return Result.err(Status.BadRequest);
  }
  const settings = (
    await loadOrchestratorWorkflows(organizationId, [
      conversation.case.workflowId,
    ])
  ).get(conversation.case.workflowId);
  const debounceSeconds = settings?.debounceSeconds ?? 0;
  const ref = `agentflow-${randomUUID()}`;
  const messageId = await withDb.tx(async (tx) => {
    const created = await tx.orchestratorMessage.create({
      data: {
        organizationId,
        conversationId,
        origin: OrchestratorMessageOrigin.External,
        kind: OrchestratorMessageKind.Message,
        actor: displayUserName(user),
        text: messageText(text, answers, questions),
        externalRef: ref,
        dedupKey: `agentflow:${ref}`,
        payload: {
          via: OrchestratorMessageVia.AgentFlow,
          userId,
          answers,
          parentId: null,
          ...(toAgent ? { toAgent } : {}),
        },
      },
      select: { id: true },
    });
    if (answers.length > 0) {
      await tx.orchestratorTask.updateMany({
        where: {
          id: { in: [...new Set(answers.map((answer) => answer.taskId))] },
          caseId,
          organizationId,
        },
        data: { openQuestionCount: 0 },
      });
    }
    await tx.orchestratorConversation.updateMany({
      where: { id: conversationId, organizationId },
      data: { nextWakeAt: new Date(Date.now() + debounceSeconds * 1000) },
    });
    await tx.orchestratorCase.updateMany({
      where: {
        id: caseId,
        organizationId,
        status: OrchestratorCaseStatus.Closed,
      },
      data: { status: OrchestratorCaseStatus.Open, closedAt: null },
    });
    return created.id;
  });
  if (debounceSeconds === 0) {
    waitUntil(advanceConversation(conversationId));
  }
  return Result.ok({ messageId, conversationId });
}

/**
 * The agent of the case's newest task on that compute target, or null. When
 * that agent has a task with open questions, the marker names the newest one.
 */
async function findAddressedAgent(
  organizationId: string,
  caseId: string,
  computeTargetId: string
): Promise<{
  computeTargetId: string;
  name: string;
  openQuestionTaskId?: string;
} | null> {
  const task = await withDb((db) =>
    db.orchestratorTask.findFirst({
      where: { organizationId, caseId, computeTargetId },
      orderBy: { createdAt: "desc" },
      select: { computeTarget: { select: { id: true, machineName: true } } },
    })
  );
  if (!task?.computeTarget) {
    return null;
  }
  const open = await withDb((db) =>
    db.orchestratorTask.findFirst({
      where: {
        organizationId,
        caseId,
        computeTargetId,
        openQuestionCount: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
  );
  return {
    computeTargetId: task.computeTarget.id,
    name: task.computeTarget.machineName,
    ...(open ? { openQuestionTaskId: open.id } : {}),
  };
}

/** The question text per "taskId:questionId", or null when one is unknown. */
async function answeredQuestions(
  organizationId: string,
  caseId: string,
  answers: Answer[]
): Promise<Map<string, string> | null> {
  const found = new Map<string, string>();
  if (answers.length === 0) {
    return found;
  }
  const taskIds = [...new Set(answers.map((answer) => answer.taskId))];
  const tasks = await withDb((db) =>
    db.orchestratorTask.findMany({
      where: { id: { in: taskIds }, caseId, organizationId },
      select: { id: true, result: true },
    })
  );
  const byTask = new Map(tasks.map((task) => [task.id, task.result]));
  for (const answer of answers) {
    if (!byTask.has(answer.taskId)) {
      return null;
    }
    const question = readTaskResult(byTask.get(answer.taskId))?.questions.find(
      (candidate) => candidate.id === answer.questionId
    );
    if (!question) {
      return null;
    }
    found.set(`${answer.taskId}:${answer.questionId}`, question.question);
  }
  return found;
}

function messageText(
  text: string,
  answers: Answer[],
  questions: Map<string, string>
): string {
  const blocks: string[] = text ? [text] : [];
  const taskIds = [...new Set(answers.map((answer) => answer.taskId))];
  for (const taskId of taskIds) {
    const lines = answers
      .filter((answer) => answer.taskId === taskId)
      .map(
        (answer) =>
          `- ${questions.get(`${taskId}:${answer.questionId}`)}: ${answer.answer}`
      );
    blocks.push(
      [`Answers to the questions of task ${taskId}:`, ...lines].join("\n")
    );
  }
  return blocks.join("\n\n");
}
