import {
  LOOP_STEP_PATHS_MAX,
  LOOP_STEP_WORK_DIR,
  type LoopStepCollectedFile,
  type LoopStepConfig,
  LoopStepFile,
} from "@agentflow-ai/loops-api/loop-step";
import { normalizeConnectionGrants } from "@repo/api/src/types/connection-grants";
import {
  LoopCommand,
  LoopErrorCode,
  LoopStatus,
} from "@repo/api/src/types/loop";
import {
  type AgentProcessStep,
  agentStepFinish,
  nextProcessStep,
  ProcessQuestionsPolicy,
  type ProcessStep,
  ProcessStepFinish,
  ProcessStepRole,
  ProcessStepType,
  type ProcessToolkit,
  type ProjectProcess,
  type RunStepState,
  runStepStateSchema,
  writesReleaseNotes,
} from "@repo/api/src/types/project-process";
import { Result } from "@repo/api/src/types/result";
import {
  type WorkflowAgentConfig,
  type WorkflowRunError,
  WorkflowRunErrorCode,
  WorkflowRunEvent,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import {
  WorkflowSameItem,
  WorkflowSessionCarryAttempt,
  WorkflowSessionCarryReason,
} from "@repo/api/src/types/workflow-same-item";
import { withDb } from "@repo/database";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { documentVersionService } from "@/app/documents/document-version-service";
import type { SourceItem } from "@/lib/integrations/types";
import type { CarriedSessionMetadata } from "@/lib/loops/carried-session-metadata";
import { readStepResult } from "@/lib/loops/loop-commands/step-handler";
import { renderTemplate } from "@/lib/workflows/template";
import { freshRequestPrompt } from "./carried-request";
import {
  type CarriedSession,
  carriedSessionInput,
  findCarriedSession,
  readLoopCarriedSession,
} from "./carried-session";
import { approvePlanDocument, markIssueInReview } from "./documents";
import { RUNNER_WITHOUT_TOOLS, runError } from "./errors";
import { readSameItem } from "./item-queue";
import { launchStepLoop } from "./launch-step";
import { stepLaunchFailure } from "./personal-runner-queue";
import { type RunProcess, readRunProcessSnapshot } from "./process";
import { enterReview } from "./review-step";
import { readRunCommentIds } from "./run-comments";
import { readAgentConfig, readRunSource, toJsonObject } from "./run-data";
import {
  findLatestRunLoop,
  isLoopSettled,
  listRunLoops,
  type RunLoopState,
  readRepoExecutionResults,
} from "./run-loops";
import { recordRunRepositoryBranches } from "./run-repository";
import {
  publishReleaseNotes,
  publishRunPlanVersion,
  publishStepDocument,
  STEP_RELEASE_NOTES_FILE,
} from "./step-documents";
import {
  type EngineRun,
  failRun,
  loopFailure,
  phaseTimedOut,
  type RunTransitionData,
  type StepOutcome,
  timeoutFailure,
  transition,
  WAIT,
} from "./step-outcome";
import {
  STEP_MAX_ATTEMPTS,
  STEP_RETRY_BACKOFF_MS,
  stepRetryDelayMs,
} from "./step-retry";

/**
 * Agent steps of a project process (ProcessStepType.Agent, docs/workflows.md
 * "Project process"): the run is `running` while the step's STEP loop works
 * in the run's workspace. When the loop ends, the step either stops the run
 * with its questions (`needs_input`), ends it, or hands over to the next
 * step, which phases.ts enters.
 */

export type AgentStepStart = {
  run: EngineRun;
  agent: WorkflowAgentConfig;
  runProcess: RunProcess;
  step: AgentProcessStep;
  projectId: string;
  runAsUser: { id: string; clerkId: string };
  /** The run's documents (the run row may not hold them yet while ingesting). */
  documents: { featureDocumentId: string; planDocumentId: string | null };
  /** Events of the transition into the step. */
  events: WorkflowRunEvent[];
  /** Columns of that transition (step id, snapshot, an earlier step's branch). */
  data: RunTransitionData | undefined;
  /**
   * The run's source item as fetched when the run started: a workflow that
   * continues the item's earlier session (agent.sameItem queue_resume) reads
   * the messages written since from it.
   */
  item?: SourceItem;
};

/** What a finished agent step leads to. */
export type AgentStepSettlement =
  | { kind: "outcome"; outcome: StepOutcome }
  | {
      kind: "next";
      next: ProcessStep;
      agent: WorkflowAgentConfig;
      runProcess: RunProcess;
      /** Columns the transition into the next step also sets. */
      data: RunTransitionData;
      /** Events of the transition (execute.completed after a pushing step). */
      events: WorkflowRunEvent[];
    }
  | {
      /** The step's questions could not be read: resume it to rewrite them. */
      kind: "repairQuestions";
      step: AgentProcessStep;
      /** The loop that wrote them. */
      loopId: string;
      /** Why they could not be read. */
      error: string;
      /** Repair attempts including this one. */
      attempts: number;
      data: RunTransitionData;
    }
  | {
      /**
       * The step's agent failed on the model provider and the backoff of an
       * automatic retry (AgentProcessStep.retry) elapsed: its session goes on
       * in a fork.
       */
      kind: "autoRetry";
      step: AgentProcessStep;
      /** The failed loop. */
      loop: RunLoopState;
      /** Automatic retries including this one. */
      attempts: number;
    }
  | {
      /**
       * A first-step attempt that continued an earlier run's session failed
       * because the runner no longer had it (or could not start it): the next
       * attempt (a copy of the session, then a fresh one) is launched.
       */
      kind: "carryFallback";
      step: AgentProcessStep;
      /** The failed attempt loop. */
      loop: RunLoopState;
      carried: CarriedSessionMetadata;
    }
  | {
      /** A plan step ended without its plan: resume it to write the plan. */
      kind: "repairOutput";
      step: AgentProcessStep;
      /** The loop that did not write it. */
      loopId: string;
      /** Repair attempts including this one. */
      attempts: number;
      data: RunTransitionData;
    };

/** Times an asking step is resumed to rewrite questions that could not be read. */
export const QUESTIONS_REPAIR_MAX = 1;

/** Times a plan step is resumed to write the plan it did not write. */
export const OUTPUT_REPAIR_MAX = 1;

/** Path of the Issue in the loop workspace ({{issue.file}}). */
export const STEP_ISSUE_FILE = `${LOOP_STEP_WORK_DIR}/${LoopStepFile.Issue}`;

/** Where a plan step writes the run's plan, and an implement step reads the approved one. */
export const STEP_PLAN_FILE = `${LOOP_STEP_WORK_DIR}/${LoopStepFile.Plan}`;

/** Launches the step's STEP loop and moves the run into the step (`running`). */
export async function startAgentStep(
  input: AgentStepStart
): Promise<StepOutcome> {
  const { run, step, events } = input;
  const data: RunTransitionData = { ...input.data, stepState: null };
  const started = [...events, ...stepStartedEvents(step)];
  // An implement step works from the approved plan, as EXECUTE does.
  if (step.role === ProcessStepRole.Implement) {
    const approved = await approveRunPlan(
      input.documents.planDocumentId,
      run.organizationId
    );
    if (approved) {
      return failRun(approved, events);
    }
  }
  // A retry after a crash between the launch and the status write: the loop
  // of this step already exists, so do not launch a second one.
  const launched = await findLatestRunLoop(
    run.id,
    LoopCommand.Step,
    run.phaseStartedAt,
    step.id
  );
  if (launched) {
    return transition(WorkflowRunStatus.Running, started, data);
  }
  // The run's earlier loops hold its workspace: the step continues there.
  const earlierLoops = await listRunLoops(run.id);
  if (
    input.item &&
    readSameItem(run.agentConfig) === WorkflowSameItem.QueueResume &&
    !earlierLoops.some((loop) => loop.sessionId !== null)
  ) {
    return await launchFirstStepCarried(
      { ...input, item: input.item },
      earlierLoops,
      started,
      data
    );
  }
  const instruction = await renderStepInstruction(
    run,
    step,
    input.documents.featureDocumentId
  );
  // Only the first launch of a queued run names its request; no query.
  const request =
    earlierLoops.length === 0
      ? freshRequestPrompt(run, instruction)
      : { prompt: instruction };
  const launch = await launchStepLoop({
    runId: run.id,
    organizationId: run.organizationId,
    projectId: input.projectId,
    runAsUser: input.runAsUser,
    documentId:
      input.documents.planDocumentId ?? input.documents.featureDocumentId,
    sourceDocumentId: input.documents.featureDocumentId,
    agent: input.agent,
    step: {
      ...toLoopStepConfig({
        runId: run.id,
        step,
        toolkit: input.runProcess.process.toolkit,
        fresh: earlierLoops.length === 0,
      }),
      ...(request.inputs ? { inputs: request.inputs } : {}),
    },
    prompt: request.prompt,
    computeTargetId: earlierLoops.at(-1)?.computeTargetId ?? null,
  });
  if (!launch.ok) {
    return stepLaunchFailure(launch.error, events);
  }
  return transition(WorkflowRunStatus.Running, started, data);
}

/**
 * running: wait for the step's loop, then stop for its questions, end the run
 * after the last step, or hand over to the next step. A TIMED_OUT loop that
 * its desktop can still revive is waited for.
 */
export async function settleAgentStep(
  run: EngineRun,
  now: Date
): Promise<AgentStepSettlement> {
  const agent = readAgentConfig(run.agentConfig);
  const snapshot = readRunProcessSnapshot(run.process);
  const step = snapshot
    ? snapshot.definition.steps.find(
        (candidate): candidate is AgentProcessStep =>
          candidate.id === run.stepId &&
          candidate.type === ProcessStepType.Agent
      )
    : undefined;
  if (!(agent && snapshot && step)) {
    return outcome(failRun(stepUnreadableError()));
  }
  const loop = await findLatestRunLoop(
    run.id,
    LoopCommand.Step,
    undefined,
    step.id
  );
  if (!loop) {
    return outcome(
      failRun(
        runError(
          WorkflowRunErrorCode.StepFailed,
          `No loop is linked to the "${step.name}" step.`
        )
      )
    );
  }
  if (!(await isLoopSettled(loop, now))) {
    return outcome(
      phaseTimedOut(run, now)
        ? timeoutFailure(`in the "${step.name}" step`)
        : WAIT
    );
  }
  const loopError = await settledLoopError(step, loop);
  if (loopError) {
    const fallback = await carryFallbackFor(run, step, loop);
    return fallback ?? autoRetryOrFail(run, step, loop, loopError);
  }

  return await settleStepOutputs({
    run,
    step,
    loop,
    agent,
    process: snapshot.definition,
    now,
  });
}

/** A step whose loop completed: its documents, questions, then the next step. */
async function settleStepOutputs(input: {
  run: EngineRun;
  step: AgentProcessStep;
  loop: RunLoopState;
  agent: WorkflowAgentConfig;
  process: ProjectProcess;
  now: Date;
}): Promise<AgentStepSettlement> {
  const { run, step, loop } = input;
  const data = await recordPushedBranches(run, step, loop);
  const executed = pushingStepEvents(step, WorkflowRunEvent.ExecuteCompleted);
  const result = readStepResult(loop.uploadedArtifacts);
  const published = await publishStepOutputs(run, step, result?.files ?? []);
  if (!published.ok) {
    return outcome(retryPublish(run, published.error));
  }
  const asks = step.questions === ProcessQuestionsPolicy.Ask;
  if (asks && result?.questionsError) {
    return unreadableQuestions(
      run,
      step,
      loop.loopId,
      result.questionsError,
      data
    );
  }
  const questions = result?.questions ?? [];
  const asking = asks && questions.length > 0;
  if (step.role === ProcessStepRole.Plan && !published.value && !asking) {
    return missingPlan(run, step, loop.loopId, data);
  }
  if (asking) {
    const state: RunStepState = {
      waiting: {
        stepId: step.id,
        loopId: loop.loopId,
        questions,
        askedAt: input.now.toISOString(),
        answers: null,
        answeredBy: null,
      },
      approval: null,
    };
    return outcome(
      transition(
        WorkflowRunStatus.NeedsInput,
        [...executed, WorkflowRunEvent.NeedsInput],
        { ...data, stepState: toJsonObject(state) }
      )
    );
  }
  const finished = [...stepFinishedEvents(step), ...executed];
  if (step.review) {
    return outcome(
      enterReview({
        run,
        step,
        loopId: loop.loopId,
        data,
        events: finished,
        now: input.now,
      })
    );
  }
  const next = nextProcessStep(input.process, step.id);
  if (!next) {
    return outcome(
      transition(
        WorkflowRunStatus.Succeeded,
        [...finished, WorkflowRunEvent.Succeeded],
        { ...data, error: null }
      )
    );
  }
  return {
    kind: "next",
    next,
    agent: input.agent,
    runProcess: { process: input.process, snapshot: true },
    data,
    events: finished,
  };
}

/** True while the run waits for the answers to an agent step's questions. */
export function isWaitingOnAgentStep(run: Pick<EngineRun, "stepState">) {
  return readRunStepState(run.stepState)?.waiting != null;
}

export function readRunStepState(value: unknown): RunStepState | null {
  const parsed = runStepStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function outcome(value: StepOutcome): AgentStepSettlement {
  return { kind: "outcome", outcome: value };
}

/**
 * A pushing step sets the branch each repository was pushed to (for the
 * pull request actions) and the run's branch, and moves the Issue to review.
 */
async function recordPushedBranches(
  run: EngineRun,
  step: AgentProcessStep,
  loop: { branchName: string | null; uploadedArtifacts: unknown }
): Promise<RunTransitionData> {
  if (agentStepFinish(step) !== ProcessStepFinish.Push) {
    return {};
  }
  await recordRunRepositoryBranches(
    run.id,
    run.organizationId,
    readRepoExecutionResults(loop.uploadedArtifacts)
  );
  if (run.featureDocumentId) {
    await markIssueInReview(run.featureDocumentId, run.organizationId);
  }
  return loop.branchName ? { branchName: loop.branchName } : {};
}

/**
 * A pushing step is the run's implementation, like EXECUTE: it reports
 * execute.started / execute.completed (`event`); other steps report nothing.
 */
function pushingStepEvents(
  step: AgentProcessStep,
  event: WorkflowRunEvent
): WorkflowRunEvent[] {
  return agentStepFinish(step) === ProcessStepFinish.Push ? [event] : [];
}

export function toLoopStepConfig(input: {
  runId: string;
  step: AgentProcessStep;
  toolkit: ProcessToolkit | null;
  fresh: boolean;
}): LoopStepConfig {
  const { step, toolkit } = input;
  return {
    runId: input.runId,
    stepId: step.id,
    name: step.name,
    fresh: input.fresh,
    askQuestions: step.questions === ProcessQuestionsPolicy.Ask,
    // The role's files, the reply and the document are collected like
    // artifacts (first, so they always fit).
    artifacts: [
      ...new Set(
        [
          ...roleOutputFiles(step),
          step.reply,
          step.document?.path,
          ...step.artifacts,
        ].filter((path): path is string => Boolean(path))
      ),
    ].slice(0, LOOP_STEP_PATHS_MAX),
    finish: agentStepFinish(step),
    // The step's grant gives its agent integration tools.
    ...(normalizeConnectionGrants(step.connections).length > 0
      ? { integrationTools: true }
      : {}),
    toolkit: toolkit
      ? {
          repository: toolkit.repository,
          mounts: toolkit.mounts,
          instructions: toolkit.instructions,
        }
      : null,
    ...(step.role ? { role: step.role } : {}),
    ...(writesReleaseNotes(step) ? { releaseNotes: true } : {}),
  };
}

/** The step's instruction with the run's variables (PROCESS_INSTRUCTION_VARIABLES). */
export async function renderStepInstruction(
  run: EngineRun,
  step: AgentProcessStep,
  featureDocumentId: string
): Promise<string> {
  const issue = await documentVersionService.getLatest(featureDocumentId);
  return renderTemplate(step.instruction, {
    ...runIssueVariables(run),
    "issue.body": issue?.content ?? "",
    "issue.file": STEP_ISSUE_FILE,
  });
}

/** {{issue.key}}, {{issue.title}} and {{issue.url}} of the run's source item. */
export function runIssueVariables(run: Pick<EngineRun, "source">) {
  const source = readRunSource(run.source);
  const item = source?.inlineItem ?? source?.item ?? null;
  return {
    "issue.key": item?.key ?? "",
    "issue.title": item?.title ?? "",
    "issue.url": item?.url ?? "",
  };
}

/** Publishing again after a backoff, or a failed run once every attempt is used. */
function retryPublish(run: EngineRun, error: WorkflowRunError): StepOutcome {
  const delayMs = stepRetryDelayMs(run.stepAttempts + 1);
  if (delayMs === null) {
    return failRun({
      ...error,
      message: `${error.message} (gave up after ${STEP_MAX_ATTEMPTS} attempts)`,
    });
  }
  return { kind: "retry", delayMs, error };
}

/**
 * Why the step's settled loop fails the run: it did not complete, or its
 * step had integration tools its runner never opened (an older runner), so
 * its agent could not act. Null when the loop completed as it should.
 */
async function settledLoopError(
  step: AgentProcessStep,
  loop: RunLoopState
): Promise<WorkflowRunError | null> {
  if (loop.status !== LoopStatus.Completed) {
    return loopFailure(
      WorkflowRunErrorCode.StepFailed,
      `"${step.name}" step`,
      loop
    );
  }
  return (await stepToolsNeverOpened(loop.loopId))
    ? runError(
        WorkflowRunErrorCode.StepFailed,
        `"${step.name}" step: ${RUNNER_WITHOUT_TOOLS}`
      )
    : null;
}

/**
 * True when the step's loop had integration tools but its runner never asked
 * for them (a runner from before integration tools).
 */
async function stepToolsNeverOpened(loopId: string): Promise<boolean> {
  const session = await withDb((db) =>
    db.integrationToolSession.findUnique({
      where: { loopId },
      select: { issuedAt: true },
    })
  );
  return session !== null && session.issuedAt === null;
}

/** Files a step's role writes, collected before any other. */
function roleOutputFiles(step: AgentProcessStep): string[] {
  if (step.role === ProcessStepRole.Plan) {
    return [STEP_PLAN_FILE];
  }
  return writesReleaseNotes(step) ? [STEP_RELEASE_NOTES_FILE] : [];
}

/**
 * A plan step's plan as a new version of the run's plan document. Ok(true)
 * when the step wrote one, Ok(false) when it did not (or has no plan role).
 */
async function publishPlanOutput(
  run: EngineRun,
  step: AgentProcessStep,
  files: readonly LoopStepCollectedFile[]
): Promise<Result<boolean, WorkflowRunError>> {
  if (step.role !== ProcessStepRole.Plan) {
    return Result.ok(false);
  }
  const file = files.find((candidate) => candidate.path === STEP_PLAN_FILE);
  if (!file?.content.trim()) {
    return Result.ok(false);
  }
  if (!(run.planDocumentId && run.runAsUserId)) {
    return Result.err(
      runError(
        WorkflowRunErrorCode.PlanStateUnavailable,
        `The "${step.name}" step wrote a plan, but the run has no implementation plan document to keep it in.`
      )
    );
  }
  const published = await publishRunPlanVersion({
    run: {
      id: run.id,
      organizationId: run.organizationId,
      planDocumentId: run.planDocumentId,
      runAsUserId: run.runAsUserId,
    },
    step,
    file,
  });
  return published.ok ? Result.ok(true) : published;
}

/**
 * A plan step ended without its plan and without questions: resume it once to
 * write the plan, then fail the step.
 */
function missingPlan(
  run: EngineRun,
  step: AgentProcessStep,
  loopId: string,
  data: RunTransitionData
): AgentStepSettlement {
  const repair = readRunStepState(run.stepState)?.outputRepair;
  const attempts = repair?.stepId === step.id ? repair.attempts : 0;
  if (attempts < OUTPUT_REPAIR_MAX) {
    return {
      kind: "repairOutput",
      step,
      loopId,
      attempts: attempts + 1,
      data,
    };
  }
  return outcome(
    failRun(
      runError(
        WorkflowRunErrorCode.StepFailed,
        `The "${step.name}" step did not write the plan to ${STEP_PLAN_FILE}, also after it was asked to.`
      )
    )
  );
}

/**
 * Approves the run's plan before an implement step works from it. Null when
 * approved, else why the run cannot go on.
 */
async function approveRunPlan(
  planDocumentId: string | null,
  organizationId: string
): Promise<WorkflowRunError | null> {
  if (!planDocumentId) {
    return runError(
      WorkflowRunErrorCode.PlanStateUnavailable,
      "The run has no implementation plan for the implement step to work from."
    );
  }
  try {
    await approvePlanDocument(planDocumentId, organizationId);
    return null;
  } catch (error) {
    log.warn("workflow.plan_approval_failed", {
      organizationId,
      reason: "plan_approval_failed",
      error,
    });
    return runError(
      WorkflowRunErrorCode.PlanStateUnavailable,
      `The implementation plan could not be approved: ${parseError(error)}`
    );
  }
}

/** Events of entering a step: plan.started for a plan step, execute.started for a pushing one. */
export function stepStartedEvents(step: AgentProcessStep): WorkflowRunEvent[] {
  return [
    ...(step.role === ProcessStepRole.Plan
      ? [WorkflowRunEvent.PlanStarted]
      : []),
    ...pushingStepEvents(step, WorkflowRunEvent.ExecuteStarted),
  ];
}

/** plan.completed once a plan step wrote the plan and goes on. */
function stepFinishedEvents(step: AgentProcessStep): WorkflowRunEvent[] {
  return step.role === ProcessStepRole.Plan ? [WorkflowRunEvent.PlanReady] : [];
}

function stepUnreadableError(): WorkflowRunError {
  return runError(
    WorkflowRunErrorCode.AgentConfigInvalid,
    "The run's process step could not be read."
  );
}

/**
 * The step's documents: its own document, a plan step's plan and an
 * implement step's release notes. Ok(true) when a plan step wrote its plan.
 */
async function publishStepOutputs(
  run: EngineRun,
  step: AgentProcessStep,
  files: readonly LoopStepCollectedFile[]
): Promise<Result<boolean, WorkflowRunError>> {
  const variables = runIssueVariables(run);
  const published = await publishStepDocument({
    run,
    projectId: run.projectId,
    step,
    files,
    variables,
  });
  if (!published.ok) {
    return published;
  }
  if (writesReleaseNotes(step)) {
    const notes = await publishReleaseNotes({
      run,
      projectId: run.projectId,
      step,
      files,
      variables,
    });
    if (!notes.ok) {
      return notes;
    }
  }
  return await publishPlanOutput(run, step, files);
}

/**
 * Questions that could not be read: resume the step to rewrite them
 * (QUESTIONS_REPAIR_MAX times), then fail it.
 */
function unreadableQuestions(
  run: EngineRun,
  step: AgentProcessStep,
  loopId: string,
  error: string,
  data: RunTransitionData
): AgentStepSettlement {
  const repair = readRunStepState(run.stepState)?.questionsRepair;
  const attempts = repair?.stepId === step.id ? repair.attempts : 0;
  if (attempts < QUESTIONS_REPAIR_MAX) {
    return {
      kind: "repairQuestions",
      step,
      loopId,
      error,
      attempts: attempts + 1,
      data,
    };
  }
  return outcome(
    failRun(
      runError(
        WorkflowRunErrorCode.StepFailed,
        `The "${step.name}" step wrote questions that could not be read, also after it was asked to rewrite them: ${error}`
      )
    )
  );
}

/**
 * Loop failures of the model provider (an expired token, a quota, an
 * overload, LoopErrorCode.AuthChallenge) that an automatic retry may outlast.
 */
const AUTO_RETRY_LOOP_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  LoopErrorCode.AuthChallenge,
]);

/**
 * A failed step loop fails the run, unless the step retries automatically
 * (AgentProcessStep.retry) after a model provider failure: the run keeps
 * running, waits the backoff (stepAttempts, nextStepAt), then the failed
 * session goes on in a fork, at most `retry.attempts` times.
 */
function autoRetryOrFail(
  run: EngineRun,
  step: AgentProcessStep,
  loop: RunLoopState,
  error: WorkflowRunError
): AgentStepSettlement {
  const allowed = step.retry?.attempts ?? 0;
  const retryable =
    allowed > 0 &&
    loop.sessionId !== null &&
    loop.error !== null &&
    AUTO_RETRY_LOOP_ERROR_CODES.has(loop.error.code);
  if (!retryable) {
    return outcome(failRun(error));
  }
  const state = readRunStepState(run.stepState)?.autoRetry;
  const used = state?.stepId === step.id ? state.attempts : 0;
  if (used >= allowed) {
    return outcome(
      failRun({
        ...error,
        message: `${error.message} (gave up after ${used} automatic retries)`,
      })
    );
  }
  if (run.stepAttempts === 0) {
    const delayMs =
      stepRetryDelayMs(used + 1) ?? STEP_RETRY_BACKOFF_MS.at(-1) ?? 0;
    return outcome({ kind: "retry", delayMs, error });
  }
  return { kind: "autoRetry", step, loop, attempts: used + 1 };
}

/** Launch errors on a carried attempt that start a fresh session instead (the earlier runner could not take it). */
const CARRY_FALLBACK_LAUNCH_ERRORS: ReadonlySet<string> = new Set<string>([
  WorkflowRunErrorCode.ComputeTargetUnavailable,
  WorkflowRunErrorCode.AgentNotInProject,
  WorkflowRunErrorCode.SigningRequired,
  WorkflowRunErrorCode.DispatchFailed,
  WorkflowRunErrorCode.PlanStateUnavailable,
]);

/** Loop error codes of a carried attempt that go on to the next attempt. */
const CARRY_FALLBACK_LOOP_ERRORS: ReadonlySet<string> = new Set<string>([
  LoopErrorCode.ResumeSessionNotFound,
  LoopErrorCode.LaunchFailed,
]);

/** What launching a fresh session for a run needs. */
export type CarriedFreshInput = {
  run: EngineRun;
  agent: WorkflowAgentConfig;
  projectId: string;
  runAsUser: { id: string; clerkId: string };
  step: AgentProcessStep;
  toolkit: ProcessToolkit | null;
  documents: { featureDocumentId: string; planDocumentId: string | null };
};

/**
 * A failed attempt loop of a carried session that the next attempt follows
 * (agent.sameItem queue_resume): null for every other failure, which takes the
 * step's normal failure path. No query unless the workflow continues sessions.
 */
async function carryFallbackFor(
  run: EngineRun,
  step: AgentProcessStep,
  loop: RunLoopState
): Promise<AgentStepSettlement | null> {
  if (
    readSameItem(run.agentConfig) !== WorkflowSameItem.QueueResume ||
    !loop.error ||
    !CARRY_FALLBACK_LOOP_ERRORS.has(loop.error.code)
  ) {
    return null;
  }
  const carried = await readLoopCarriedSession(loop.loopId, run.organizationId);
  if (!carried || carried.attempt === WorkflowSessionCarryAttempt.Fresh) {
    return null;
  }
  return { kind: "carryFallback", step, loop, carried };
}

/**
 * The first step of a run whose workflow continues the item's session: resume
 * the earlier run's session when it can be, else start a fresh one with the
 * reason recorded on the loop.
 */
async function launchFirstStepCarried(
  input: AgentStepStart & { item: SourceItem },
  earlierLoops: RunLoopState[],
  started: WorkflowRunEvent[],
  data: RunTransitionData
): Promise<StepOutcome> {
  const { run, step, events } = input;
  const freshInput = carriedFreshInput(input);
  const done = (launch: Awaited<ReturnType<typeof launchStepLoop>>) =>
    launch.ok
      ? transition(WorkflowRunStatus.Running, started, data)
      : stepLaunchFailure(launch.error, events);

  const latest = earlierLoops.at(-1);
  if (latest) {
    return done(await relaunchFresh(freshInput, latest));
  }

  const stepConfig = toLoopStepConfig({
    runId: run.id,
    step,
    toolkit: input.runProcess.process.toolkit,
    fresh: true,
  });
  const found = await findCarriedSession({
    run,
    stepId: step.id,
    runAsUserId: input.runAsUser.id,
    documentId:
      input.documents.planDocumentId ?? input.documents.featureDocumentId,
    pushes: agentStepFinish(step) === ProcessStepFinish.Push,
    artifacts: stepConfig.artifacts,
  });
  if (!found.ok) {
    return done(await launchCarriedFresh(freshInput, found.error));
  }
  const carried = found.value;
  const built = await carriedStepInputs(input, carried);
  const resumed = await launchStepLoop({
    ...carriedLaunchBase(freshInput),
    step: { ...stepConfig, inputs: built.inputs, reportResumeMiss: true },
    prompt: built.prompt,
    computeTargetId: carried.loop.computeTargetId,
    resumeLoopId: carried.loop.loopId,
    carried: {
      fromRunId: carried.fromRunId,
      attempt: WorkflowSessionCarryAttempt.Resume,
      depth: carried.depth,
      reason: null,
    },
    workspace: carried.workspace,
  });
  if (resumed.ok || !CARRY_FALLBACK_LAUNCH_ERRORS.has(resumed.error.code)) {
    return done(resumed);
  }
  log.info("workflow.run.session_carry_fallback", {
    workflowRunId: run.id,
    fromRunId: carried.fromRunId,
    reason: WorkflowSessionCarryReason.CarriedLaunchFailed,
    error: resumed.error,
  });
  return done(
    await launchCarriedFresh(freshInput, {
      fromRunId: carried.fromRunId,
      reason: WorkflowSessionCarryReason.CarriedLaunchFailed,
    })
  );
}

/**
 * A fresh launch when the run already has a loop but no session (the earlier
 * launch hit a busy runner or a dispatch failure): the attempt that loop
 * belonged to says why.
 */
async function relaunchFresh(input: CarriedFreshInput, latest: RunLoopState) {
  const before = await readLoopCarriedSession(
    latest.loopId,
    input.run.organizationId
  );
  const resumedBefore =
    before !== null && before.attempt !== WorkflowSessionCarryAttempt.Fresh;
  return await launchCarriedFresh(input, {
    fromRunId: before?.fromRunId ?? null,
    reason:
      resumedBefore || !before?.reason
        ? WorkflowSessionCarryReason.CarriedLaunchFailed
        : before.reason,
  });
}

function carriedFreshInput(input: AgentStepStart): CarriedFreshInput {
  return {
    run: input.run,
    agent: input.agent,
    projectId: input.projectId,
    runAsUser: input.runAsUser,
    step: input.step,
    toolkit: input.runProcess.process.toolkit,
    documents: input.documents,
  };
}

/** The launch fields every attempt shares. */
function carriedLaunchBase(input: CarriedFreshInput) {
  return {
    runId: input.run.id,
    organizationId: input.run.organizationId,
    projectId: input.projectId,
    runAsUser: input.runAsUser,
    documentId:
      input.documents.planDocumentId ?? input.documents.featureDocumentId,
    sourceDocumentId: input.documents.featureDocumentId,
    agent: input.agent,
  };
}

/**
 * The short prompt and the messages file of a resumed attempt: what was
 * written on the item between the earlier run's request and this one.
 */
async function carriedStepInputs(
  input: AgentStepStart & { item: SourceItem },
  carried: CarriedSession
) {
  const { run, step } = input;
  const source = readRunSource(run.source);
  return carriedSessionInput({
    instruction: await renderStepInstruction(
      run,
      step,
      input.documents.featureDocumentId
    ),
    item: input.item,
    previous: {
      occurredAt: carried.previousSource?.occurredAt ?? null,
      messageId: carried.previousSource?.message?.id ?? null,
    },
    current: {
      occurredAt: source?.occurredAt ?? new Date().toISOString(),
      messageId: source?.message?.id ?? null,
      text: source?.message?.text ?? null,
    },
    ownCommentIds: await readRunCommentIds({
      id: carried.fromRunId,
      organizationId: run.organizationId,
    }),
  });
}

/**
 * A new session with the full thread, on the normally resolved runner: the
 * fallback of a carried session. The attempt and its reason are recorded on
 * the loop, which also ends the run's carried folder.
 */
export async function launchCarriedFresh(
  input: CarriedFreshInput,
  why: { fromRunId: string | null; reason: WorkflowSessionCarryReason }
) {
  const request = freshRequestPrompt(
    input.run,
    await renderStepInstruction(
      input.run,
      input.step,
      input.documents.featureDocumentId
    )
  );
  return await launchStepLoop({
    ...carriedLaunchBase(input),
    step: {
      ...toLoopStepConfig({
        runId: input.run.id,
        step: input.step,
        toolkit: input.toolkit,
        fresh: true,
      }),
      ...(request.inputs ? { inputs: request.inputs } : {}),
    },
    prompt: request.prompt,
    computeTargetId: null,
    carried: {
      fromRunId: why.fromRunId,
      attempt: WorkflowSessionCarryAttempt.Fresh,
      depth: 0,
      reason: why.reason,
    },
    workspace: null,
  });
}
