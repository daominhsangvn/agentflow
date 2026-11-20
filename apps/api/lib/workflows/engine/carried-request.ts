import {
  LOOP_STEP_INPUTS_DIR,
  type LoopStepInputFile,
} from "@agentflow-ai/loops-api/loop-step";
import { WorkflowSameItem } from "@repo/api/src/types/workflow-same-item";
import {
  prependUntrustedLoopInputPreamble,
  wrapUntrustedLoopArtifactContent,
} from "@/lib/loops/untrusted-loop-input";
import { readSameItem } from "./item-queue";
import { readRunSource } from "./run-data";
import type { EngineRun } from "./step-outcome";

/**
 * Which message a run answers when its first agent step starts a FRESH session
 * under agent.sameItem queue or queue_resume (docs/workflows.md "Item queue").
 * The imported issue file may already hold mentions written after the one that
 * triggered the run. Resumed and forked attempts carry the request in
 * inputs/new-messages.md and do not use this. Must not import carried-session
 * (the agent-step modules import both).
 */

/** Characters of the request quoted in a fresh launch. */
const REQUEST_MAX = 8000;

/** Longest request put in the prompt itself; longer ones go to a step input file. */
export const REQUEST_PROMPT_MAX = 3000;

/** The step input file that holds a long request. */
export const REQUEST_FILE = "request.md";

/** The fresh first-step launch's prompt, with the request's inputs when they are a file. */
export function freshRequestPrompt(
  run: Pick<EngineRun, "agentConfig" | "source">,
  instruction: string
): { prompt: string; inputs?: LoopStepInputFile[] } {
  const setting = readSameItem(run.agentConfig);
  if (
    setting !== WorkflowSameItem.Queue &&
    setting !== WorkflowSameItem.QueueResume
  ) {
    return { prompt: instruction };
  }
  const source = readRunSource(run.source);
  const text = source?.message?.text.slice(0, REQUEST_MAX) ?? "";
  if (!(source?.message && text.trim())) {
    return { prompt: instruction };
  }
  const author = source.actor?.displayName ?? "Someone";
  const wrapped = wrapUntrustedLoopArtifactContent(
    `**${author}**:\n\n${text}`,
    {
      artifactType: "Source item request",
      title: source.item.title,
    }
  );
  const rule =
    "This run answers exactly one request, the message below. Later messages in the thread belong to later runs: do not answer them now, even if the issue file holds them.";
  if (text.length <= REQUEST_PROMPT_MAX) {
    return {
      prompt: `${instruction}\n\n${prependUntrustedLoopInputPreamble(`${rule}\n\n## This run's request\n\n${wrapped}`)}`,
    };
  }
  const path = `$AGENTFLOW_WORKDIR/${LOOP_STEP_INPUTS_DIR}/${REQUEST_FILE}`;
  return {
    prompt: `${instruction}\n\n${prependUntrustedLoopInputPreamble(`${rule}\n\nRead \`${path}\`: this run's request (the message that started it).`)}`,
    inputs: [{ name: REQUEST_FILE, content: wrapped }],
  };
}
