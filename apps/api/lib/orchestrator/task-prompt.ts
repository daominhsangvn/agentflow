import {
  LOOP_STEP_INPUTS_DIR,
  LOOP_STEP_WORK_DIR,
  splitAttachGlob,
} from "@agentflow-ai/loops-api/loop-step";
import { ORCHESTRATOR_TASK_REPLY_FILE } from "@repo/api/src/types/orchestrator";
import { RunnerCommandMode } from "@repo/api/src/types/runner-capabilities";

/** The command and its arguments first (a slash command is expanded), then the request. */
export function buildTaskPrompt(
  task: {
    command: string;
    args: string;
    prompt: string;
    mode: string;
  },
  files: { attach: string[]; inputs: string[]; attachChanged?: boolean } = {
    attach: [],
    inputs: [],
  }
): string {
  const head = [task.command, task.args].filter(Boolean).join(" ");
  const readOnly =
    task.mode === RunnerCommandMode.Read
      ? " This task only reads: change no file of the project, commit nothing."
      : "";
  return [
    head,
    task.prompt.trim(),
    `---\nYou run as a task of the project's orchestrator in AgentFlow. When you are done, write your answer for the orchestrator to \`${ORCHESTRATOR_TASK_REPLY_FILE}\` (on a personal runner: \`$AGENTFLOW_WORKDIR/orchestrator-reply.md\`): what you found or did, concise, with file paths and links where they help.${readOnly}${attachNote(files.attach, files.attachChanged === true)}${inputsNote(files.inputs)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function attachNote(attach: string[], changedOnly: boolean): string {
  if (attach.length === 0) {
    return "";
  }
  const named = attach.filter((glob) => splitAttachGlob(glob).root !== null);
  const local = attach.filter((glob) => splitAttachGlob(glob).root === null);
  let note = "";
  if (local.length > 0) {
    note += ` Leave the files your command writes for the ticket (${local.join(", ")}) in \`${LOOP_STEP_WORK_DIR}/\` (on a personal runner: \`$AGENTFLOW_WORKDIR\`): AgentFlow collects them when you finish and the orchestrator attaches them to the ticket.`;
  }
  if (named.length > 0) {
    note += ` Files matching ${named.join(", ")} are collected from the folders your AGENTFLOW.md names (the part before ":"); write them there as your command does.`;
  }
  if (changedOnly) {
    note += " Only files created or changed during this task are collected.";
  }
  return note;
}

function inputsNote(inputs: string[]): string {
  if (inputs.length === 0) {
    return "";
  }
  return ` Files from earlier tasks of this case are in \`${LOOP_STEP_WORK_DIR}/${LOOP_STEP_INPUTS_DIR}/\` (on a personal runner: \`$AGENTFLOW_WORKDIR/${LOOP_STEP_INPUTS_DIR}/\`): ${inputs.join(", ")}.`;
}

/** A work-directory glob gets the step's work dir; a named-root glob goes through as is. */
export function stepAttachGlob(glob: string): string {
  if (splitAttachGlob(glob).root === null) {
    return `${LOOP_STEP_WORK_DIR}/${glob}`;
  }
  return glob;
}
