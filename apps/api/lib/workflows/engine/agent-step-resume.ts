import {
  LOOP_STEP_OPTION_MAX,
  LOOP_STEP_OPTIONS_MAX,
  LOOP_STEP_QUESTION_MAX,
  LOOP_STEP_QUESTIONS_MAX,
  LOOP_STEP_WORK_DIR,
  LoopStepFile,
} from "@agentflow-ai/loops-api/loop-step";
import { LoopCommand, LoopErrorCode } from "@repo/api/src/types/loop";
import {
  type AgentProcessStep,
  type ProcessAnswer,
  ProcessStepType,
  type RunStepState,
} from "@repo/api/src/types/project-process";
import {
  type WorkflowAgentConfig,
  WorkflowRunErrorCode,
  WorkflowRunEvent,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import {
  WorkflowSessionCarryAttempt,
  WorkflowSessionCarryReason,
} from "@repo/api/src/types/workflow-same-item";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import { computeTargetsService } from "@/app/compute-targets/service";
import type { SourceItem, SourceItemComment } from "@/lib/integrations/types";
import { runnerForksSession } from "@/lib/runner-fork-session";
import {
  type AgentStepSettlement,
  launchCarriedFresh,
  STEP_ISSUE_FILE,
  STEP_PLAN_FILE,
  stepStartedEvents,
  toLoopStepConfig,
} from "./agent-step";
import { readCarriedLoop } from "./carried-session";
import { runError } from "./errors";
import { launchStepLoop } from "./launch-step";
import { stepLaunchFailure } from "./personal-runner-queue";
import { readRunProcessSnapshot } from "./process";
import { toJsonObject } from "./run-data";
import {
  findLatestRunLoop,
  listRunLoops,
  type RunLoopState,
} from "./run-loops";
import {
  type EngineRun,
  failRun,
  type RunTransitionData,
  type StepOutcome,
  transition,
} from "./step-outcome";

/**
 * Answers to the questions of a waiting agent step (docs/workflows.md
 * "Project process"): a new STEP loop continues the asking loop's agent
 * session (its parent loop; the computer resumes the session with
 * `--resume`) with the answers as its prompt, on the same computer and in
 * the same workspace. Answers come from AgentFlow (POST
 * /workflow-runs/{id}/answers) or from the source item's comments when it
 * triggers the run again.
 */

type WaitingStep = NonNullable<RunStepState["waiting"]>;

export type ResumeAgentStepInput = {
  run: EngineRun;
  agent: WorkflowAgentConfig;
  projectId: string;
  runAsUser: { id: string; clerkId: string };
  waiting: WaitingStep;
  /** The answers, as the agent reads them. */
  prompt: string;
  /** Events of the transition back into the step. */
  events: WorkflowRunEvent[];
  /**
   * The cycle the resumed step runs in, when the answers start a new one
   * (given in AgentFlow; an item that re-triggers the run already did).
   */
  cycle?: number;
};

export async function resumeAgentStep(
  input: ResumeAgentStepInput
): Promise<StepOutcome> {
  const { run, waiting } = input;
  const snapshot = readRunProcessSnapshot(run.process);
  const step = snapshot?.definition.steps.find(
    (candidate): candidate is AgentProcessStep =>
      candidate.id === waiting.stepId &&
      candidate.type === ProcessStepType.Agent
  );
  const documentId = run.planDocumentId ?? run.featureDocumentId;
  if (!(snapshot && step && documentId)) {
    return failRun(
      runError(
        WorkflowRunErrorCode.AgentConfigInvalid,
        "The waiting process step could not be read, so the answers cannot be passed on."
      ),
      input.events
    );
  }
  // A plan step that goes on with the answers writes the plan again.
  const events = [
    ...input.events,
    ...stepStartedEvents(step).filter(
      (event) => event === WorkflowRunEvent.PlanStarted
    ),
  ];
  const data: RunTransitionData = {
    stepId: step.id,
    stepState: null,
    ...(input.cycle === undefined ? {} : { cycle: input.cycle }),
  };
  // A retry after a crash between the launch and the status write.
  const launched = await findLatestRunLoop(
    run.id,
    LoopCommand.Step,
    run.phaseStartedAt,
    step.id
  );
  if (launched) {
    return transition(WorkflowRunStatus.Running, events, data);
  }
  const askingLoop = (await listRunLoops(run.id)).find(
    (loop) => loop.loopId === waiting.loopId
  );
  const launch = await launchStepLoop({
    runId: run.id,
    organizationId: run.organizationId,
    projectId: input.projectId,
    runAsUser: input.runAsUser,
    documentId,
    sourceDocumentId: run.featureDocumentId,
    agent: input.agent,
    step: toLoopStepConfig({
      runId: run.id,
      step,
      toolkit: snapshot.definition.toolkit,
      fresh: false,
    }),
    prompt: input.prompt,
    computeTargetId: askingLoop?.computeTargetId ?? null,
    resumeLoopId: waiting.loopId,
  });
  if (!launch.ok) {
    return stepLaunchFailure(launch.error, events);
  }
  return transition(WorkflowRunStatus.Running, events, data);
}

/** The prompt of answers given in AgentFlow. */
export function answersPrompt(
  waiting: WaitingStep,
  answers: readonly ProcessAnswer[]
): string {
  const byId = new Map(answers.map((answer) => [answer.id, answer.answer]));
  const lines = waiting.questions.map((question) => {
    const answer = byId.get(question.id) ?? "(no answer: decide yourself)";
    return `- ${question.question}\n  Answer: ${answer}`;
  });
  return [
    "The developer answered your questions:",
    "",
    ...lines,
    "",
    "Continue the step with these answers. Do not ask these questions again.",
  ].join("\n");
}

/**
 * The prompt of answers given on the source item: its comments written after
 * the step asked, else a pointer to the refreshed Issue. `ownCommentIds` are
 * the comments this run posted (its questions among them): they are never
 * answers, and when people replied in the thread of one of them, only those
 * replies are, so the questions of another run on the same item (asked and
 * answered in their own threads) cannot be taken for this run's answers.
 */
export function ticketAnswersPrompt(
  waiting: WaitingStep,
  item: SourceItem,
  ownCommentIds: ReadonlySet<string> = new Set()
): string {
  const comments = answerComments(waiting, item, ownCommentIds);
  const questions = waiting.questions.map(
    (question) => `- ${question.question}`
  );
  const answers =
    comments.length > 0
      ? comments.map(
          (comment) =>
            `${comment.author ?? "Someone"}: ${comment.bodyMarkdown.trim()}`
        )
      : [
          `The developer updated the issue instead; re-read ${STEP_ISSUE_FILE}.`,
        ];
  return [
    "You asked the developer:",
    ...questions,
    "",
    "They answered on the issue:",
    "",
    ...answers,
    "",
    `The updated issue is in ${STEP_ISSUE_FILE}. Continue the step with these answers. Do not ask these questions again.`,
  ].join("\n");
}

export type RepairStepInput = {
  run: EngineRun;
  agent: WorkflowAgentConfig;
  projectId: string;
  runAsUser: { id: string; clerkId: string };
  step: AgentProcessStep;
  /** The loop whose output could not be used; its session is resumed. */
  loopId: string;
  /** Repair attempts including this one. */
  attempts: number;
  /** Columns the settled step already set (pushed branches). */
  data: RunTransitionData;
};

export type RepairStepQuestionsInput = RepairStepInput & {
  /** Why the questions could not be read. */
  error: string;
};

/**
 * Questions that could not be read (too long, not JSON, ...) do not fail the
 * step outright: the asking session is resumed on its computer to rewrite
 * them within the limits (QUESTIONS_REPAIR_MAX times). The run stays
 * `running`; the step settles again when that loop ends.
 */
export async function repairStepQuestions(
  input: RepairStepQuestionsInput
): Promise<StepOutcome> {
  return await resumeForRepair(
    input,
    {
      waiting: null,
      approval: null,
      questionsRepair: {
        stepId: input.step.id,
        loopId: input.loopId,
        attempts: input.attempts,
      },
    },
    questionsRepairPrompt(input.error)
  );
}

/**
 * A plan step that ended without writing the plan is resumed on its computer
 * to write it (OUTPUT_REPAIR_MAX times). The run stays `running`.
 */
export async function repairStepOutput(
  input: RepairStepInput
): Promise<StepOutcome> {
  return await resumeForRepair(
    input,
    {
      waiting: null,
      approval: null,
      outputRepair: {
        stepId: input.step.id,
        loopId: input.loopId,
        attempts: input.attempts,
      },
    },
    planRepairPrompt()
  );
}

/** A settled step whose output could not be used, resumed to fix it. */
export async function repairStep(
  run: EngineRun,
  context: {
    agent: WorkflowAgentConfig;
    projectId: string;
    runAsUser: { id: string; clerkId: string };
  },
  settled: Extract<
    AgentStepSettlement,
    { kind: "repairQuestions" } | { kind: "repairOutput" }
  >
): Promise<StepOutcome> {
  const input: RepairStepInput = {
    run,
    ...context,
    step: settled.step,
    loopId: settled.loopId,
    attempts: settled.attempts,
    data: settled.data,
  };
  return settled.kind === "repairQuestions"
    ? await repairStepQuestions({ ...input, error: settled.error })
    : await repairStepOutput(input);
}

/** Resumes the session of `input.loopId` with `prompt`, recording `state`. */
async function resumeForRepair(
  input: RepairStepInput,
  state: RunStepState,
  prompt: string
): Promise<StepOutcome> {
  const { run, step } = input;
  const snapshot = readRunProcessSnapshot(run.process);
  const documentId = run.planDocumentId ?? run.featureDocumentId;
  if (!(snapshot && documentId)) {
    return failRun(
      runError(
        WorkflowRunErrorCode.AgentConfigInvalid,
        "The process step could not be read, so it cannot be resumed."
      )
    );
  }
  const data: RunTransitionData = {
    ...input.data,
    stepState: toJsonObject(state),
  };
  // A retry after a crash between the launch and the status write: the
  // step's latest loop is then the repair, not the loop being repaired.
  const latest = await findLatestRunLoop(
    run.id,
    LoopCommand.Step,
    undefined,
    step.id
  );
  if (latest && latest.loopId !== input.loopId) {
    return transition(WorkflowRunStatus.Running, [], data);
  }
  const writer = (await listRunLoops(run.id)).find(
    (loop) => loop.loopId === input.loopId
  );
  const launch = await launchStepLoop({
    runId: run.id,
    organizationId: run.organizationId,
    projectId: input.projectId,
    runAsUser: input.runAsUser,
    documentId,
    sourceDocumentId: run.featureDocumentId,
    agent: input.agent,
    step: toLoopStepConfig({
      runId: run.id,
      step,
      toolkit: snapshot.definition.toolkit,
      fresh: false,
    }),
    prompt,
    computeTargetId: writer?.computeTargetId ?? null,
    resumeLoopId: input.loopId,
  });
  if (!launch.ok) {
    return stepLaunchFailure(launch.error);
  }
  return transition(WorkflowRunStatus.Running, [], data);
}

/** What the resumed session is told when its questions could not be read. */
export function questionsRepairPrompt(error: string): string {
  const file = `${LOOP_STEP_WORK_DIR}/${LoopStepFile.Questions}`;
  return [
    `Your questions could not be read from ${file}: ${error}`,
    "",
    `Rewrite ${file} as a JSON array of {"id": "q1", "question": "...", "options": ["..."]} within these limits: at most ${LOOP_STEP_QUESTIONS_MAX} questions; each question at most ${LOOP_STEP_QUESTION_MAX} characters; at most ${LOOP_STEP_OPTIONS_MAX} options per question, each at most ${LOOP_STEP_OPTION_MAX} characters. Keep the options short and put the reasoning in the question.`,
    "Keep the same questions and change nothing else, then stop.",
  ].join("\n");
}

/** What a plan step's resumed session is told when it did not write the plan. */
export function planRepairPrompt(): string {
  return [
    `The step ended without the implementation plan in ${STEP_PLAN_FILE}.`,
    "",
    `Write the final plan to ${STEP_PLAN_FILE} now (copy it there if you wrote it elsewhere), then stop. If you cannot plan without a decision from the developer, write your questions instead, as the workspace instructions say.`,
  ].join("\n");
}

/**
 * Comments after the question that answer it: replies in the thread of one
 * of the run's own comments when there are any, else the top-level comments
 * (a reply in another thread answers someone else).
 */
function answerComments(
  waiting: WaitingStep,
  item: SourceItem,
  ownCommentIds: ReadonlySet<string>
): SourceItemComment[] {
  const askedAt = Date.parse(waiting.askedAt);
  const later = item.comments.filter((comment) => {
    const at = comment.createdAt ? Date.parse(comment.createdAt) : Number.NaN;
    return (
      Number.isFinite(at) &&
      at > askedAt &&
      !(comment.id && ownCommentIds.has(comment.id))
    );
  });
  const replies = later.filter(
    (comment) => comment.parentId && ownCommentIds.has(comment.parentId)
  );
  if (replies.length > 0) {
    return replies;
  }
  return later.filter((comment) => !comment.parentId);
}

export type ResumeFailedStepInput = {
  run: EngineRun;
  agent: WorkflowAgentConfig;
  projectId: string;
  runAsUser: { id: string; clerkId: string };
  step: AgentProcessStep;
  /** The failed loop; its agent session goes on in a fork. */
  loop: RunLoopState;
  /** Events of the transition back into the step. */
  events: WorkflowRunEvent[];
  /** Columns the transition also sets (cycle, error, step state). */
  data: RunTransitionData;
};

/**
 * Runs a failed agent step again in its own session: a new STEP loop on the
 * failed loop's computer resumes the failed session in a fork (`--resume
 * <session> --fork-session`), told what stopped it, so the agent goes on
 * from where it stopped instead of starting the step over (a retry by a
 * workflow administrator, or an automatic one, AgentProcessStep.retry).
 */
export async function resumeFailedStep(
  input: ResumeFailedStepInput
): Promise<StepOutcome> {
  const { run, step, loop } = input;
  const snapshot = readRunProcessSnapshot(run.process);
  const documentId = run.planDocumentId ?? run.featureDocumentId;
  if (!(snapshot && documentId && loop.sessionId)) {
    return failRun(
      runError(
        WorkflowRunErrorCode.AgentConfigInvalid,
        `The "${step.name}" step has no agent session to go on with.`
      ),
      input.events
    );
  }
  // A retry after a crash between the launch and the status write: the
  // step's latest loop is then the retry, not the failed loop.
  const latest = await findLatestRunLoop(
    run.id,
    LoopCommand.Step,
    undefined,
    step.id
  );
  if (latest && latest.loopId !== loop.loopId) {
    return transition(WorkflowRunStatus.Running, input.events, input.data);
  }
  const launch = await launchStepLoop({
    runId: run.id,
    organizationId: run.organizationId,
    projectId: input.projectId,
    runAsUser: input.runAsUser,
    documentId,
    sourceDocumentId: run.featureDocumentId,
    agent: input.agent,
    step: {
      ...toLoopStepConfig({
        runId: run.id,
        step,
        toolkit: snapshot.definition.toolkit,
        fresh: false,
      }),
      forkSession: true,
    },
    prompt: failedStepPrompt(loop),
    computeTargetId: loop.computeTargetId,
    resumeLoopId: loop.loopId,
  });
  if (!launch.ok) {
    return stepLaunchFailure(launch.error, input.events);
  }
  return transition(WorkflowRunStatus.Running, input.events, input.data);
}

/** What the forked session of a failed step is told. */
export function failedStepPrompt(loop: Pick<RunLoopState, "error">): string {
  const reason = loop.error?.message
    ? `It stopped with this error: ${loop.error.message}`
    : "It stopped before it finished.";
  return [
    `Your work on this step was interrupted. ${reason}`,
    "",
    "The problem is fixed. Continue the step from where it stopped: check what is already done (files, commits, subagents' results) and finish the rest. Do not redo finished work.",
  ].join("\n");
}

/**
 * The automatic retry of a step whose agent failed on the model provider,
 * once its backoff elapsed (AgentProcessStep.retry): the failed session goes
 * on in a fork while the run stays running; the step state counts the retries.
 */
export async function autoRetryStep(
  run: EngineRun,
  context: {
    agent: WorkflowAgentConfig;
    projectId: string;
    runAsUser: { id: string; clerkId: string };
  },
  settled: Extract<AgentStepSettlement, { kind: "autoRetry" }>
): Promise<StepOutcome> {
  const state: RunStepState = {
    waiting: null,
    approval: null,
    autoRetry: {
      stepId: settled.step.id,
      loopId: settled.loop.loopId,
      attempts: settled.attempts,
    },
  };
  return await resumeFailedStep({
    run,
    ...context,
    step: settled.step,
    loop: settled.loop,
    events: [],
    data: { stepState: toJsonObject(state) },
  });
}

/** Launch errors on a forked attempt that go on to a fresh session. */
const FORK_FALLBACK_LAUNCH_ERRORS: ReadonlySet<string> = new Set<string>([
  WorkflowRunErrorCode.ComputeTargetUnavailable,
  WorkflowRunErrorCode.AgentNotInProject,
  WorkflowRunErrorCode.SigningRequired,
  WorkflowRunErrorCode.DispatchFailed,
  WorkflowRunErrorCode.PlanStateUnavailable,
]);

/**
 * The next attempt after a carried session failed (agent.sameItem
 * queue_resume): the runner no longer had the session, so a copy of it
 * (`--fork-session`) is tried once when the runner forks, then a fresh session
 * with the full thread. A loop that never started (LAUNCH_FAILED) goes
 * straight to the fresh session. The fork is launched with the settings and
 * prompt of the failed attempt, which already hold the messages file.
 */
export function continueCarriedStep(
  run: EngineRun,
  context: CarriedStepContext,
  settled: Extract<AgentStepSettlement, { kind: "carryFallback" }>
): Promise<StepOutcome> {
  return withSpan(
    "workflow.carried_step_fallback",
    {
      [AfAttribute.WorkflowRunId]: run.id,
      [AfAttribute.OrgId]: run.organizationId,
      [AfAttribute.LoopId]: settled.loop.loopId,
    },
    async (span) => {
      const outcome = await continueCarriedStepInSpan(run, context, settled);
      if (outcome.kind === "transition" && outcome.data?.error) {
        setSpanOutcome(AfOutcome.Error, outcome.data.error.code, span);
      }
      return outcome;
    }
  );
}

type CarriedStepContext = {
  agent: WorkflowAgentConfig;
  projectId: string;
  runAsUser: { id: string; clerkId: string };
};

async function continueCarriedStepInSpan(
  run: EngineRun,
  context: CarriedStepContext,
  settled: Extract<AgentStepSettlement, { kind: "carryFallback" }>
): Promise<StepOutcome> {
  const { step, loop } = settled;
  const snapshot = readRunProcessSnapshot(run.process);
  if (!(snapshot && run.featureDocumentId)) {
    return failRun(
      runError(
        WorkflowRunErrorCode.AgentConfigInvalid,
        `The "${step.name}" step could not be read, so its session cannot be continued.`
      )
    );
  }
  // A retry after a crash between the launch and the status write: the
  // step's latest loop is then the next attempt, not the failed one.
  const latest = await findLatestRunLoop(
    run.id,
    LoopCommand.Step,
    undefined,
    step.id
  );
  if (latest && latest.loopId !== loop.loopId) {
    return transition(WorkflowRunStatus.Running, [], { stepState: null });
  }
  const failed = await readCarriedLoop(loop.loopId, run.organizationId);
  const missed = loop.error?.code === LoopErrorCode.ResumeSessionNotFound;
  const fresh = {
    run,
    ...context,
    step,
    toolkit: snapshot.definition.toolkit,
    documents: {
      featureDocumentId: run.featureDocumentId,
      planDocumentId: run.planDocumentId,
    },
  };
  const forks =
    missed &&
    failed?.parentLoopId != null &&
    failed.step !== null &&
    settled.carried.attempt === WorkflowSessionCarryAttempt.Resume &&
    (await runnerForksLoop(loop, run.organizationId));
  const reason = fallbackReason(settled, missed);
  log.info("workflow.run.session_carry_fallback", {
    workflowRunId: run.id,
    loopId: loop.loopId,
    reason,
    next: forks
      ? WorkflowSessionCarryAttempt.Fork
      : WorkflowSessionCarryAttempt.Fresh,
  });
  if (forks && failed?.parentLoopId && failed.step) {
    const forked = await launchStepLoop({
      runId: run.id,
      organizationId: run.organizationId,
      projectId: context.projectId,
      runAsUser: context.runAsUser,
      documentId: run.planDocumentId ?? run.featureDocumentId,
      sourceDocumentId: run.featureDocumentId,
      agent: context.agent,
      step: { ...failed.step, forkSession: true },
      prompt: failed.prompt ?? "",
      computeTargetId: loop.computeTargetId,
      resumeLoopId: failed.parentLoopId,
      carried: {
        fromRunId: settled.carried.fromRunId,
        attempt: WorkflowSessionCarryAttempt.Fork,
        depth: settled.carried.depth,
        reason,
      },
      workspace: failed.workspace,
    });
    return forkOutcome(forked, async () =>
      launchCarriedFresh(fresh, {
        fromRunId: settled.carried.fromRunId,
        reason: WorkflowSessionCarryReason.CarriedLaunchFailed,
      })
    );
  }
  const launched = await launchCarriedFresh(fresh, {
    fromRunId: settled.carried.fromRunId,
    reason,
  });
  return launched.ok
    ? transition(WorkflowRunStatus.Running, [], { stepState: null })
    : stepLaunchFailure(launched.error);
}

/** The runner of the failed loop forks sessions (organization-scoped). */
async function runnerForksLoop(
  loop: RunLoopState,
  organizationId: string
): Promise<boolean> {
  if (!loop.computeTargetId) {
    return false;
  }
  const target = await computeTargetsService.findById(loop.computeTargetId);
  return (
    target?.organizationId === organizationId &&
    runnerForksSession(target.capabilities)
  );
}

/** Why the attempt after `settled` is not a plain resume. */
function fallbackReason(
  settled: Extract<AgentStepSettlement, { kind: "carryFallback" }>,
  missed: boolean
): WorkflowSessionCarryReason {
  if (!missed) {
    return WorkflowSessionCarryReason.CarriedLaunchFailed;
  }
  return settled.carried.attempt === WorkflowSessionCarryAttempt.Fork
    ? WorkflowSessionCarryReason.ForkSessionNotFound
    : WorkflowSessionCarryReason.ResumeSessionNotFound;
}

/** A fork launch's outcome: a busy runner waits, a runner that cannot take it goes to fresh, anything else fails. */
async function forkOutcome(
  forked: Awaited<ReturnType<typeof launchStepLoop>>,
  fresh: () => ReturnType<typeof launchStepLoop>
): Promise<StepOutcome> {
  if (forked.ok) {
    return transition(WorkflowRunStatus.Running, [], { stepState: null });
  }
  if (!FORK_FALLBACK_LAUNCH_ERRORS.has(forked.error.code)) {
    return stepLaunchFailure(forked.error);
  }
  const launched = await fresh();
  return launched.ok
    ? transition(WorkflowRunStatus.Running, [], { stepState: null })
    : stepLaunchFailure(launched.error);
}
