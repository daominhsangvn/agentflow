import { Result } from "@repo/api/src/types/result";
import { checkInputsFit, resolveTaskInputs } from "./task-files";
import type { TaskInputFile, TaskPageInput, TaskResult } from "./task-result";
import type { StartTaskInput } from "./tasks";

/** The result a task starts with: its checked input files and pages, and the message it replies to. */
function initialTaskResult(
  inputs: TaskInputFile[] | null,
  pageInputs: TaskPageInput[],
  replyTo: string | null
): TaskResult | null {
  if (!(inputs || replyTo || pageInputs.length > 0)) {
    return null;
  }
  return {
    reply: null,
    questions: [],
    error: null,
    ...(inputs ? { inputs } : {}),
    ...(pageInputs.length > 0 ? { pageInputs } : {}),
    ...(replyTo ? { replyTo } : {}),
  };
}

/** Checks the task's input files and pages and builds the result it starts with. */
export async function initialResultFor(
  input: StartTaskInput
): Promise<Result<TaskResult | null, string>> {
  const inputs =
    input.files.length > 0
      ? await resolveTaskInputs(input.caseId, input.files)
      : null;
  if (inputs && !inputs.ok) {
    return Result.err(inputs.error);
  }
  const resolved = inputs?.ok ? inputs.value : null;
  const fits = checkInputsFit(resolved ?? [], input.pageInputs);
  if (!fits.ok) {
    return Result.err(fits.error);
  }
  return Result.ok(
    initialTaskResult(resolved, input.pageInputs, input.replyTo)
  );
}
