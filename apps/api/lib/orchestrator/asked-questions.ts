import { z } from "zod";
import type { TaskQuestion } from "./task-result";

/**
 * Helpers for questions an agent asked on the source item itself
 * (questions.json commentId); see docs/orchestrator.md.
 */

type AskedQuestion = TaskQuestion & { commentId: string };

/** The questions that carry a commentId. */
export function askedOnItem(questions: TaskQuestion[]): AskedQuestion[] {
  return questions.filter((q): q is AskedQuestion => Boolean(q.commentId));
}

/** The Case record text for questions a task's agent asked on the item. */
export function askedQuestionsText(input: {
  taskId: string;
  command: string;
  runnerName: string | null;
  itemKey: string | null;
  questions: AskedQuestion[];
}): string {
  const head = `Task ${input.taskId} (\`${input.command}\` on ${input.runnerName ?? "a removed runner"}) asked on ${input.itemKey ?? "the item"} itself, under its person's own account. They are already posted: do not post them again; the replies to those comments come as messages with task="${input.taskId}".`;
  const lines = input.questions.map(
    (q) => `- ${q.id} (comment ${q.commentId}): ${q.question}`
  );
  return [head, ...lines].join("\n");
}

/** The task and question an inbound message payload answers, or null. */
export function readAnsweredQuestion(payload: unknown): {
  taskId: string;
  questionId: string | null;
  questionIds: string[] | null;
} | null {
  const parsed = answeredQuestionSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  return {
    taskId: parsed.data.taskId,
    questionId: parsed.data.questionId ?? null,
    questionIds: parsed.data.questionIds ?? null,
  };
}

/** The suffix that marks a question as already asked on the item. */
export function askedQuestionNote(question: TaskQuestion): string {
  if (!question.commentId) {
    return "";
  }
  return ` — already asked on the item (comment ${question.commentId}): do not post it again`;
}

const answeredQuestionSchema = z.object({
  taskId: z.string().min(1),
  questionId: z.string().nullish(),
  questionIds: z.array(z.string()).nullish(),
});
