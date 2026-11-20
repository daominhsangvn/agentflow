import {
  type LoopStepConfig,
  LoopStepFinish,
} from "@agentflow-ai/loops-api/loop-step";
import type { JsonObject } from "@repo/api/src/types/common";
import {
  LoopCommand,
  LoopStatus,
  MAX_ADDITIONAL_REPOS,
} from "@repo/api/src/types/loop";
import { readPersonalAgentProjectKey } from "@repo/api/src/types/project-runners";
import { Result } from "@repo/api/src/types/result";
import {
  type WorkflowAgentConfig,
  type WorkflowRunError,
  WorkflowRunErrorCode,
} from "@repo/api/src/types/workflow";
import {
  WorkflowSameItem,
  WorkflowSessionCarryAttempt,
} from "@repo/api/src/types/workflow-same-item";
import { withDb } from "@repo/database";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import { computeTargetsService } from "@/app/compute-targets/service";
import { integrationToolSessionService } from "@/app/integration-tools/integration-tool-session-service";
import { loopsService } from "@/app/loops/service";
import {
  findRepositoryCheckout,
  type LoopRepositorySelection,
  listProjectRepositoryCheckouts,
  toLoopRepositorySelection,
} from "@/app/projects/project-repository-checkouts";
import {
  CARRIED_SESSION_METADATA_KEY,
  CARRIED_WORKSPACE_METADATA_KEY,
  type CarriedSessionMetadata,
  type CarriedWorkspaceMetadata,
  readCarriedSessionMetadata,
  readCarriedWorkspaceMetadata,
} from "@/lib/loops/carried-session-metadata";
import { resolveLaunchHarness } from "@/lib/loops/launch-harness";
import {
  LOOP_STEP_METADATA_KEY,
  readLoopStepConfig,
} from "@/lib/loops/loop-commands/step-handler";
import { dispatchAndClassify } from "@/lib/loops/loop-dispatch-utils";
import {
  forkUnsupportedMessage,
  runnerForksSession,
} from "@/lib/runner-fork-session";
import { runError } from "./errors";
import { readSameItem } from "./item-queue";
import {
  cancelBlockedLoop,
  checkCommandSigning,
  dispatchError,
  mapLoopCreateError,
  resolveProjectComputeTarget,
} from "./launch";
import { personalRunnerBusy } from "./personal-runner-queue";
import { listRunLoops, recordRunLoop } from "./run-loops";
import { recordRunRepositories } from "./run-repository";

/**
 * Launches the STEP loop of one agent step of a run's process: the
 * equivalent of launch.ts for process steps (docs/workflows.md "Project
 * process"). Every expected failure comes back as a run error.
 *
 * - A step works in the project repositories (integration connections); the
 *   GitHub App team pool is not used. A step on a personal Agent may have
 *   none: it works in the Agent's project folder.
 * - The run's steps share one workspace on one computer: the first loop of a
 *   run picks the computer like PLAN does, every later loop runs where the
 *   run's earlier loops ran.
 * - The workflow_run_loops row (with the step id) is written before the
 *   dispatch, so the run owns the loop even when the dispatch fails.
 */

export type LaunchStepLoopInput = {
  runId: string;
  organizationId: string;
  projectId: string;
  runAsUser: { id: string; clerkId: string };
  /** The run's plan document when it has one, else its Issue. */
  documentId: string;
  /**
   * The run's PRD or Issue. When the loop works on the plan, it is sent with
   * it, so the step reads the item it works on as well as the plan.
   */
  sourceDocumentId?: string | null;
  agent: WorkflowAgentConfig;
  /** The step settings the computer runs (loop metadata, sent with the loop). */
  step: LoopStepConfig;
  /** The rendered instruction (or the answers when resuming). */
  prompt: string;
  /** Computer of the run's earlier loops; null for the run's first loop. */
  computeTargetId: string | null;
  /** The loop whose agent session this one continues (answers to its questions). */
  resumeLoopId?: string;
  /** An attempt loop of a carried session (agent.sameItem queue_resume): recorded in the loop metadata. */
  carried?: CarriedSessionMetadata;
  /**
   * The run's carried folder (an auto runner runs every loop of a carried run
   * in the earlier run's folder). Undefined: derive it from the run's attempt
   * loops; null: none.
   */
  workspace?: CarriedWorkspaceMetadata | null;
};

export function launchStepLoop(
  input: LaunchStepLoopInput
): Promise<
  Result<{ loopId: string; computeTargetId: string }, WorkflowRunError>
> {
  return withSpan(
    "workflow.launch_step_loop",
    {
      [AfAttribute.WorkflowRunId]: input.runId,
      [AfAttribute.OrgId]: input.organizationId,
    },
    async (span) => {
      const result = await launchStepLoopLocked(input);
      if (result.ok) {
        span.setAttribute(AfAttribute.LoopId, result.value.loopId);
        span.setAttribute(
          AfAttribute.ComputeTargetId,
          result.value.computeTargetId
        );
      } else {
        setSpanOutcome(AfOutcome.Error, result.error.message, span);
      }
      return result;
    }
  );
}

async function launchStepLoopLocked(
  input: LaunchStepLoopInput
): Promise<
  Result<{ loopId: string; computeTargetId: string }, WorkflowRunError>
> {
  const repositories = await resolveStepRepositories(input);
  if (!repositories.ok) {
    return repositories;
  }

  const target: Result<string, WorkflowRunError> = input.computeTargetId
    ? Result.ok(input.computeTargetId)
    : await resolveProjectComputeTarget({
        organizationId: input.organizationId,
        userId: input.runAsUser.id,
        documentId: input.documentId,
        computeTargetId: input.agent.computeTargetId,
      });
  if (!target.ok) {
    return target;
  }
  const computeTargetId = target.value;
  if (repositories.value === null) {
    const refusal = await requirePersonalTarget(input, computeTargetId);
    if (refusal) {
      return Result.err(refusal);
    }
  }
  // An old runner would resume the parent session in place: refuse before
  // the busy check, so it fails instead of queueing.
  const forkRefusal = await forkRefusalFor(input, computeTargetId);
  if (forkRefusal) {
    return Result.err(forkRefusal);
  }
  // A personal runner that runs one task at a time takes the runs in turn.
  const busy = await personalRunnerBusy({
    organizationId: input.organizationId,
    computeTargetId,
  });
  if (busy) {
    return Result.err(busy);
  }

  const signing = await checkCommandSigning(computeTargetId, input.runAsUser);
  if (!signing.ok) {
    return signing;
  }

  const harness = await resolveLaunchHarness(
    computeTargetId,
    input.organizationId,
    { clerkUserId: input.runAsUser.clerkId, userId: input.runAsUser.id }
  );

  const carry = await resolveCarry(input);
  const step = withCarriedInputs(input.step, carry.inputs);

  let response: Awaited<ReturnType<typeof loopsService.create>>;
  try {
    response = await loopsService.create(
      input.organizationId,
      input.runAsUser.id,
      {
        command: LoopCommand.Step,
        harness,
        documentId: input.documentId,
        parentLoopId: input.resumeLoopId,
        computeTargetId,
        prompt: input.prompt,
        repo: repositories.value?.primary,
        additionalRepos: repositories.value?.additional,
        contextRefs: sourceContextRefs(input),
        metadata: stepLoopMetadata(input, step, carry.workspace),
      }
    );
  } catch (error) {
    const mapped = mapLoopCreateError(error);
    if (mapped) {
      return Result.err(mapped);
    }
    throw error;
  }
  if (response.status === LoopStatus.Blocked) {
    await cancelBlockedLoop(response.loopId, input.organizationId);
    return Result.err(
      runError(
        WorkflowRunErrorCode.DocumentBlocked,
        "The run's document is blocked by another document that is not finished yet, so the step was not started."
      )
    );
  }
  const loopId = response.loopId;
  // Another run took the runner at the same moment: the earlier loop wins.
  const raced = await personalRunnerBusy({
    organizationId: input.organizationId,
    computeTargetId,
    ownLoopId: loopId,
  });
  if (raced) {
    await cancelBlockedLoop(loopId, input.organizationId);
    return Result.err(raced);
  }

  await recordRunLoop({
    organizationId: input.organizationId,
    runId: input.runId,
    loopId,
    command: LoopCommand.Step,
    adopted: false,
    stepId: input.step.stepId,
  });
  // Repository actions ("Create pull request") work on the repositories a
  // pushing step records on the run; the first one records them, so a later
  // step never clears the branches an earlier one pushed.
  if (repositories.value && (await shouldRecordRepositories(input))) {
    await recordRunRepositories({
      runId: input.runId,
      organizationId: input.organizationId,
      repos: [repositories.value.primary, ...repositories.value.additional].map(
        (repo) => ({ fullName: repo.fullName, baseBranch: repo.branch })
      ),
    });
  }

  // Before the dispatch: the runner asks for the session's token as soon as
  // the loop starts.
  if (input.step.integrationTools) {
    await integrationToolSessionService.openForStep({
      organizationId: input.organizationId,
      runId: input.runId,
      loopId,
      stepId: input.step.stepId,
      computeTargetId,
      expiresAt: new Date(Date.now() + STEP_TOOL_SESSION_MS),
    });
  }

  const dispatch = await dispatchAndClassify(
    loopId,
    input.organizationId,
    "workflow-engine",
    { workflowRunId: input.runId, documentId: input.documentId }
  );
  if (!dispatch.ok) {
    return Result.err(dispatchError(dispatch.error));
  }
  return Result.ok({ loopId, computeTargetId });
}

/**
 * Longest a step's tool session lasts: past the longest step timeout; the
 * session ends with its loop anyway.
 */
const STEP_TOOL_SESSION_MS = 25 * 60 * 60_000;

/**
 * The project repositories the step works in: the workflow's repository (or
 * the project's primary) first, then every other one. The toolkit must be
 * one of them, so its worktree is in the workspace to load it from. Null when
 * the project has none: only a personal Agent can run such a step (the caller
 * checks), and it ignores the toolkit.
 */
async function resolveStepRepositories(
  input: LaunchStepLoopInput
): Promise<Result<LoopRepositorySelection | null, WorkflowRunError>> {
  const checkouts = await listProjectRepositoryCheckouts(
    input.organizationId,
    input.projectId
  );
  const selection = toLoopRepositorySelection(
    checkouts,
    input.agent.repository?.fullName
  );
  if (!selection) {
    return Result.ok(null);
  }
  const toolkit = input.step.toolkit;
  if (toolkit && !findRepositoryCheckout(checkouts, toolkit.repository)) {
    return Result.err(
      runError(
        WorkflowRunErrorCode.AgentConfigInvalid,
        `The process toolkit repository ${toolkit.repository} is not one of the project's repositories.`
      )
    );
  }
  return Result.ok({
    primary: selection.primary,
    additional: selection.additional.slice(0, MAX_ADDITIONAL_REPOS),
  });
}

async function shouldRecordRepositories(
  input: LaunchStepLoopInput
): Promise<boolean> {
  if (input.step.finish !== LoopStepFinish.Push) {
    return false;
  }
  const run = await withDb((db) =>
    db.workflowRun.findFirst({
      where: { id: input.runId, organizationId: input.organizationId },
      select: { repository: true },
    })
  );
  return run !== null && run.repository === null;
}

/** The run's PRD or Issue next to the plan the loop works on; none when they are the same. */
function sourceContextRefs(
  input: Pick<LaunchStepLoopInput, "documentId" | "sourceDocumentId">
): Array<{ sourceId: string; include: "full" }> | undefined {
  const sourceId = input.sourceDocumentId;
  return sourceId && sourceId !== input.documentId
    ? [{ sourceId, include: "full" }]
    : undefined;
}

/** The run error for a forked step on a runner that cannot fork, or null. */
async function forkRefusalFor(
  input: LaunchStepLoopInput,
  computeTargetId: string
): Promise<WorkflowRunError | null> {
  if (!input.step.forkSession) {
    return null;
  }
  const found = await computeTargetsService.findById(computeTargetId);
  const target = found?.organizationId === input.organizationId ? found : null;
  if (runnerForksSession(target?.capabilities)) {
    return null;
  }
  return runError(
    WorkflowRunErrorCode.ComputeTargetUnavailable,
    forkUnsupportedMessage({
      machineName: target?.machineName,
      session: "the failed step's session",
      advice:
        "Update the runner, or retry the step with Restart (a new session).",
    })
  );
}

/** The run error when a step without project repositories is not on a personal Agent, or null. */
async function requirePersonalTarget(
  input: LaunchStepLoopInput,
  computeTargetId: string
): Promise<WorkflowRunError | null> {
  const found = await computeTargetsService.findById(computeTargetId);
  const target = found?.organizationId === input.organizationId ? found : null;
  if (readPersonalAgentProjectKey(target?.capabilities) !== null) {
    return null;
  }
  return runError(
    WorkflowRunErrorCode.NoRepository,
    "The project has no repositories. Add the project's repositories from an integration connection to run its process on an automatic Agent."
  );
}

type Carry = {
  workspace: CarriedWorkspaceMetadata | null;
  /** The messages files of the carried attempt loop; the runner clears inputs/ at every step loop. */
  inputs: LoopStepConfig["inputs"];
};

const NO_CARRY: Carry = { workspace: null, inputs: undefined };

/**
 * The carried folder and input files of a loop launched without its own
 * (answers, repair, auto-retry, Restart, later steps): the run's latest
 * attempt loop decides. Resume or fork keep its folder and inputs, a fresh
 * attempt has none. No query unless the workflow continues sessions across
 * runs.
 */
async function runCarry(input: LaunchStepLoopInput): Promise<Carry> {
  if (readSameItem(input.agent) !== WorkflowSameItem.QueueResume) {
    return NO_CARRY;
  }
  const loops = await listRunLoops(input.runId);
  const ids = loops
    .filter((loop) => loop.command === LoopCommand.Step)
    .map((loop) => loop.loopId);
  if (ids.length === 0) {
    return NO_CARRY;
  }
  const rows = await withDb((db) =>
    db.loop.findMany({
      where: { id: { in: ids }, organizationId: input.organizationId },
      select: { id: true, metadata: true, createdAt: true },
    })
  );
  const attempts = rows
    .map((row) => ({
      createdAt: row.createdAt,
      carried: readCarriedSessionMetadata(row.metadata),
      workspace: readCarriedWorkspaceMetadata(row.metadata),
      inputs: readLoopStepConfig({
        command: LoopCommand.Step,
        metadata: row.metadata,
      })?.inputs,
    }))
    .filter((row) => row.carried !== null)
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    );
  const latest = attempts[0];
  if (
    !latest ||
    latest.carried?.attempt === WorkflowSessionCarryAttempt.Fresh
  ) {
    return NO_CARRY;
  }
  return { workspace: latest.workspace, inputs: latest.inputs };
}

async function resolveCarry(input: LaunchStepLoopInput): Promise<Carry> {
  if (input.workspace !== undefined) {
    return { workspace: input.workspace, inputs: undefined };
  }
  return await runCarry(input);
}

/** The step with the carried input files, unless it brings its own. */
function withCarriedInputs(
  step: LoopStepConfig,
  inputs: LoopStepConfig["inputs"]
): LoopStepConfig {
  if ((step.inputs?.length ?? 0) > 0 || !inputs || inputs.length === 0) {
    return step;
  }
  return { ...step, inputs };
}

/** The loop metadata: the run, the step, and the carried session and folder when there are any. */
function stepLoopMetadata(
  input: LaunchStepLoopInput,
  step: LoopStepConfig,
  workspace: CarriedWorkspaceMetadata | null
): JsonObject {
  return {
    workflowRunId: input.runId,
    [LOOP_STEP_METADATA_KEY]: step,
    ...(input.carried ? { [CARRIED_SESSION_METADATA_KEY]: input.carried } : {}),
    ...(workspace ? { [CARRIED_WORKSPACE_METADATA_KEY]: workspace } : {}),
  };
}
