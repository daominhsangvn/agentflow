import { AgentKind } from "./agent-fleet.ts";
import {
  agentStepFinish,
  ProcessStepFinish,
  ProcessStepType,
  type ProjectProcess,
} from "./project-process.ts";
import { WorkflowAgentMode } from "./workflow-agent-mode.ts";

/**
 * Runner fit: what a workflow asks of its runners that a runner refuses at
 * run time. Pure, so the browser editor validation (which also validates the
 * workflow builder's proposals) and the API save validation share it.
 */

export const RunnerFitSeverity = {
  Error: "error",
  Warning: "warning",
} as const;
export type RunnerFitSeverity =
  (typeof RunnerFitSeverity)[keyof typeof RunnerFitSeverity];

export const RunnerFitProblemCode = {
  PersonalNeedsAgentSteps: "personal_needs_agent_steps",
  PersonalPush: "personal_push",
  UndeclaredCommand: "undeclared_command",
} as const;
export type RunnerFitProblemCode =
  (typeof RunnerFitProblemCode)[keyof typeof RunnerFitProblemCode];

export type RunnerFitRunner = {
  /** Shown in messages, e.g. "PRO-1-BA". */
  label: string;
  /** null = unknown. */
  kind: AgentKind | null;
  /** Declared slash commands; null = unknown (the command check is skipped). */
  commands: readonly string[] | null;
};

export type RunnerFitProblem = {
  code: RunnerFitProblemCode;
  severity: RunnerFitSeverity;
  message: string;
  /** Index into input.runners (0 = agent.runner, i = agent.runners[i-1]). */
  runnerIndex: number;
  /** Index into the effective process's steps. */
  stepIndex: number | null;
  /** True when the step is in the workflow's own agent.process. */
  inOwnProcess: boolean;
};

export type RunnerFitInput = {
  mode: WorkflowAgentMode;
  /** agent.process */
  ownProcess: ProjectProcess | null;
  /** The project's current process; null = none or unknown. */
  projectProcess: ProjectProcess | null;
  runners: readonly RunnerFitRunner[];
};

export function workflowRunnerFitProblems(
  input: RunnerFitInput
): RunnerFitProblem[] {
  if (input.mode === WorkflowAgentMode.Orchestrated) {
    return [];
  }
  const process = input.ownProcess ?? input.projectProcess;
  const inOwnProcess = input.ownProcess !== null;
  const problems: RunnerFitProblem[] = [];
  input.runners.forEach((runner, runnerIndex) => {
    if (runner.kind === AgentKind.Personal) {
      problems.push(
        ...personalProblems(runner, runnerIndex, process, inOwnProcess)
      );
    }
    if (runner.commands !== null) {
      problems.push(
        ...commandProblems(runner, runnerIndex, process, inOwnProcess)
      );
    }
  });
  return problems;
}

/** The leading slash command of an instruction, or null. */
export function leadingSlashCommand(instruction: string): string | null {
  const found = LEADING_COMMAND_RE.exec(instruction.trimStart());
  return found ? found[0] : null;
}

function personalProblems(
  runner: RunnerFitRunner,
  runnerIndex: number,
  process: ProjectProcess | null,
  inOwnProcess: boolean
): RunnerFitProblem[] {
  const base = { runnerIndex, inOwnProcess, severity: RunnerFitSeverity.Error };
  if (process === null) {
    return [
      {
        ...base,
        code: RunnerFitProblemCode.PersonalNeedsAgentSteps,
        stepIndex: null,
        message: `${runner.label} is a personal runner: it runs process agent steps only, not the PLAN/EXECUTE loops agent.mode starts. Add agent.process with agent steps (e.g. one step whose instruction starts with one of the runner's commands).`,
      },
    ];
  }
  const problems: RunnerFitProblem[] = [];
  process.steps.forEach((step, stepIndex) => {
    if (
      step.type === ProcessStepType.AgentFlowPlan ||
      step.type === ProcessStepType.AgentFlowExecute
    ) {
      problems.push({
        ...base,
        code: RunnerFitProblemCode.PersonalNeedsAgentSteps,
        stepIndex,
        message: `${runner.label} is a personal runner: step ${step.id} (${step.type}) starts a PLAN/EXECUTE loop; use agent steps only.`,
      });
    } else if (
      step.type === ProcessStepType.Agent &&
      agentStepFinish(step) === ProcessStepFinish.Push
    ) {
      problems.push({
        ...base,
        code: RunnerFitProblemCode.PersonalPush,
        stepIndex,
        message: `${runner.label} is a personal runner: it does not commit and push for a step (finish: push or role: implement); remove it and let the step's own command push.`,
      });
    }
  });
  return problems;
}

function commandProblems(
  runner: RunnerFitRunner,
  runnerIndex: number,
  process: ProjectProcess | null,
  inOwnProcess: boolean
): RunnerFitProblem[] {
  const declared = runner.commands ?? [];
  const problems: RunnerFitProblem[] = [];
  process?.steps.forEach((step, stepIndex) => {
    if (step.type !== ProcessStepType.Agent) {
      return;
    }
    const command = leadingSlashCommand(step.instruction);
    if (command === null || declared.includes(command)) {
      return;
    }
    const list = declared.length > 0 ? declared.join(", ") : "none";
    problems.push({
      code: RunnerFitProblemCode.UndeclaredCommand,
      severity: RunnerFitSeverity.Warning,
      message: `${command} is not a command ${runner.label} declares in its AGENTFLOW.md (declares: ${list}).`,
      runnerIndex,
      stepIndex,
      inOwnProcess,
    });
  });
  return problems;
}

const LEADING_COMMAND_RE = /^\/[\w:.-]{1,100}/;

/** Prefixes a runner-fit message found in a trigger project's process. */
export function runnerFitInTriggerProject(
  projectName: string,
  message: string
): string {
  return `Runs of trigger project ${projectName}: ${message}`;
}
