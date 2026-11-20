import {
  LOOP_STEP_INPUTS_DIR,
  LOOP_STEP_WORK_DIR,
  type LoopStepConfig,
  LoopStepFile,
  type LoopStepInputFile,
} from "@agentflow-ai/loops-api/loop-step";
import { LoopCommand } from "@repo/api/src/types/loop";
import { readPersonalAgentProjectKey } from "@repo/api/src/types/project-runners";
import { Result } from "@repo/api/src/types/result";
import {
  WorkflowSameItem,
  WorkflowSessionCarryAttempt,
  WorkflowSessionCarryReason,
} from "@repo/api/src/types/workflow-same-item";
import { withDb } from "@repo/database";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import { computeTargetsService } from "@/app/compute-targets/service";
import type { SourceItem, SourceItemComment } from "@/lib/integrations/types";
import {
  type CarriedSessionMetadata,
  type CarriedWorkspaceMetadata,
  readCarriedSessionMetadata,
  readCarriedWorkspaceMetadata,
} from "@/lib/loops/carried-session-metadata";
import { readLoopStepConfig } from "@/lib/loops/loop-commands/step-handler";
import {
  prependUntrustedLoopInputPreamble,
  wrapUntrustedLoopArtifactContent,
} from "@/lib/loops/untrusted-loop-input";
import {
  runnerForksSession,
  runnerReportsResumeMiss,
} from "@/lib/runner-fork-session";
import { isRecord } from "@/lib/type-guards";
import {
  findPreviousItemRun,
  loadItemRunKey,
  readSameItem,
} from "./item-queue";
import { resolveProjectComputeTarget } from "./launch";
import { readRunSource, type StoredRunSource } from "./run-data";
import { listRunLoops, type RunLoopState } from "./run-loops";
import type { EngineRun } from "./step-outcome";

/**
 * The agent session an item's later run continues (agent.sameItem
 * queue_resume; docs/workflows.md "Item queue"): which earlier session to
 * resume, and the short prompt plus the messages file that tell the agent only
 * what is new. Must not import the agent-step modules (they import this one).
 */

/** Runs one session may be carried through before a new one starts. */
export const MAX_CARRIED_SESSION_DEPTH = 20;

/** Characters of earlier messages put in the messages file. */
export const CARRIED_DELTA_MAX = 40_000;

/** The messages file the agent reads (written to the loop's inputs folder). */
export const CARRIED_MESSAGES_FILE = "new-messages.md";

/** Characters of the new request put in the messages file. */
const CARRIED_REQUEST_MAX = 8000;

export type CarriedSession = {
  fromRunId: string;
  loop: Pick<RunLoopState, "loopId" | "computeTargetId" | "sessionId">;
  /** The earlier run's folder on an auto runner; null on a personal runner. */
  workspace: CarriedWorkspaceMetadata | null;
  depth: number;
  /** The runner can fork the session (the second attempt). */
  forks: boolean;
  previousSource: StoredRunSource | null;
};

export type CarriedSessionMiss = {
  reason: WorkflowSessionCarryReason;
  fromRunId: string | null;
};

type PreviousRun = NonNullable<Awaited<ReturnType<typeof findPreviousItemRun>>>;

export function findCarriedSession(input: {
  run: EngineRun;
  stepId: string;
  runAsUserId: string;
  documentId: string;
  pushes: boolean;
  artifacts: readonly string[];
}): Promise<Result<CarriedSession, CarriedSessionMiss>> {
  return withSpan(
    "workflow.carried_session",
    {
      [AfAttribute.WorkflowRunId]: input.run.id,
      [AfAttribute.OrgId]: input.run.organizationId,
    },
    async (span) => {
      const result = await selectCarriedSession(input);
      if (result.ok) {
        log.info("workflow.run.session_carried", {
          workflowRunId: input.run.id,
          fromRunId: result.value.fromRunId,
          parentLoopId: result.value.loop.loopId,
          depth: result.value.depth,
        });
        return result;
      }
      setSpanOutcome(AfOutcome.Skipped, result.error.reason, span);
      log.debug("workflow.carried_session_skipped", {
        workflowRunId: input.run.id,
        reason: result.error.reason,
      });
      return result;
    }
  );
}

/** The attempt the settled loop belongs to (its metadata), null when it is none. */
export async function readLoopCarriedSession(
  loopId: string,
  organizationId: string
): Promise<CarriedSessionMetadata | null> {
  const loop = await readCarriedLoop(loopId, organizationId);
  return loop?.carried ?? null;
}

/** What a failed attempt loop was launched with: enough to launch the next attempt the same way. */
export type CarriedLoop = {
  carried: CarriedSessionMetadata | null;
  workspace: CarriedWorkspaceMetadata | null;
  /** The loop whose session it resumed. */
  parentLoopId: string | null;
  prompt: string | null;
  step: LoopStepConfig | null;
};

export async function readCarriedLoop(
  loopId: string,
  organizationId: string
): Promise<CarriedLoop | null> {
  const row = await withDb((db) =>
    db.loop.findFirst({
      where: { id: loopId, organizationId },
      select: { metadata: true, parentLoopId: true, prompt: true },
    })
  );
  if (!row) {
    return null;
  }
  return {
    carried: readCarriedSessionMetadata(row.metadata),
    workspace: readCarriedWorkspaceMetadata(row.metadata),
    parentLoopId: row.parentLoopId,
    prompt: row.prompt,
    step:
      readLoopStepConfig({
        command: LoopCommand.Step,
        metadata: row.metadata,
      }) ?? null,
  };
}

/** The earlier messages and the new request, and the short prompt that points at them. */
export function carriedSessionInput(input: {
  instruction: string;
  item: SourceItem;
  previous: { occurredAt: string | null; messageId: string | null };
  current: {
    occurredAt: string;
    messageId: string | null;
    text: string | null;
  };
  ownCommentIds: ReadonlySet<string>;
}): { prompt: string; inputs: LoopStepInputFile[] } {
  const { item } = input;
  const messages = messagesSince(input);
  const request = (input.current.text ?? item.bodyMarkdown).slice(
    0,
    CARRIED_REQUEST_MAX
  );
  const content = [
    "# Messages since your last answer",
    renderMessages(messages, item.title),
    "# The new request",
    wrapUntrustedLoopArtifactContent(request, {
      artifactType: "Source item request",
      title: item.title,
    }),
  ].join("\n\n");
  return {
    prompt: carriedPrompt(input.instruction),
    inputs: [{ name: CARRIED_MESSAGES_FILE, content }],
  };
}

type Delta = { lines: string[]; dropped: number; known: boolean };

async function selectCarriedSession(input: {
  run: EngineRun;
  stepId: string;
  runAsUserId: string;
  documentId: string;
  pushes: boolean;
  artifacts: readonly string[];
}): Promise<Result<CarriedSession, CarriedSessionMiss>> {
  const { run } = input;
  if (readSameItem(run.agentConfig) !== WorkflowSameItem.QueueResume) {
    return miss(WorkflowSessionCarryReason.NotResume, null);
  }
  if (run.cycle !== 1) {
    return miss(WorkflowSessionCarryReason.NotFirstCycle, null);
  }
  const key = await loadItemRunKey(run.id, run.organizationId);
  const previous = key ? await findPreviousItemRun(key) : null;
  if (!previous) {
    return miss(WorkflowSessionCarryReason.NoPreviousRun, null);
  }
  const loops = await listRunLoops(previous.id);
  const session = latestSessionLoop(loops, input.stepId);
  if (!session) {
    return miss(WorkflowSessionCarryReason.NoSession, previous.id);
  }
  const rows = await readStepLoopRows(loops, run.organizationId);
  const depth = previousDepth(rows) + 1;
  if (depth > MAX_CARRIED_SESSION_DEPTH) {
    return miss(WorkflowSessionCarryReason.DepthLimit, previous.id);
  }
  const usable = await runnerStillUsable(input, session.computeTargetId);
  if (!usable) {
    return miss(WorkflowSessionCarryReason.RunnerUnavailable, previous.id);
  }
  const target = await computeTargetsService.findById(session.computeTargetId);
  if (target?.organizationId !== run.organizationId) {
    return miss(WorkflowSessionCarryReason.RunnerUnavailable, previous.id);
  }
  if (!runnerReportsResumeMiss(target.capabilities)) {
    return miss(WorkflowSessionCarryReason.RunnerCannotReportMiss, previous.id);
  }
  const workspace = await carriedWorkspaceOf({
    input,
    previous,
    sessionLoopId: session.loopId,
    rows,
    personal: readPersonalAgentProjectKey(target.capabilities) !== null,
  });
  if (!workspace.ok) {
    return miss(workspace.error, previous.id);
  }
  return Result.ok({
    fromRunId: previous.id,
    loop: {
      loopId: session.loopId,
      computeTargetId: session.computeTargetId,
      sessionId: session.sessionId,
    },
    workspace: workspace.value,
    depth,
    forks: runnerForksSession(target.capabilities),
    previousSource: readRunSource(previous.source),
  });
}

function miss(
  reason: WorkflowSessionCarryReason,
  fromRunId: string | null
): Result<CarriedSession, CarriedSessionMiss> {
  return Result.err({ reason, fromRunId });
}

/** The latest STEP loop of the step with a session and a computer, any attempt. */
function latestSessionLoop(
  loops: readonly RunLoopState[],
  stepId: string
): (RunLoopState & { computeTargetId: string }) | null {
  const candidates = loops
    .filter(
      (loop) =>
        loop.command === LoopCommand.Step &&
        loop.stepId === stepId &&
        loop.sessionId !== null &&
        loop.computeTargetId !== null
    )
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    );
  const latest = candidates[0];
  if (!latest?.computeTargetId) {
    return null;
  }
  return { ...latest, computeTargetId: latest.computeTargetId };
}

type StepLoopRow = {
  id: string;
  metadata: unknown;
  artifactId: string | null;
  createdAt: Date;
};

/** Metadata and document of the earlier run's STEP loops: one bounded query. */
async function readStepLoopRows(
  loops: readonly RunLoopState[],
  organizationId: string
): Promise<StepLoopRow[]> {
  const ids = loops
    .filter((loop) => loop.command === LoopCommand.Step)
    .map((loop) => loop.loopId);
  return await withDb((db) =>
    db.loop.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, metadata: true, artifactId: true, createdAt: true },
    })
  );
}

/** Depth of the earlier run's latest carried attempt that resumed or forked; 0 otherwise. */
function previousDepth(rows: readonly StepLoopRow[]): number {
  const attempts = rows
    .map((row) => ({
      createdAt: row.createdAt,
      carried: readCarriedSessionMetadata(row.metadata),
    }))
    .filter((row) => row.carried !== null)
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    );
  const latest = attempts[0]?.carried;
  if (!latest || latest.attempt === WorkflowSessionCarryAttempt.Fresh) {
    return 0;
  }
  return latest.depth;
}

/** True when the project's runner choice for this run is the earlier session's runner. */
async function runnerStillUsable(
  input: { run: EngineRun; runAsUserId: string; documentId: string },
  computeTargetId: string
): Promise<boolean> {
  const resolved = await resolveProjectComputeTarget({
    organizationId: input.run.organizationId,
    userId: input.runAsUserId,
    computeTargetId,
    documentId: input.documentId,
  });
  return resolved.ok && resolved.value === computeTargetId;
}

async function carriedWorkspaceOf(args: {
  input: { pushes: boolean; artifacts: readonly string[]; run: EngineRun };
  previous: PreviousRun;
  sessionLoopId: string;
  rows: readonly StepLoopRow[];
  personal: boolean;
}): Promise<
  Result<CarriedWorkspaceMetadata | null, WorkflowSessionCarryReason>
> {
  if (args.personal) {
    return Result.ok(null);
  }
  if (args.input.pushes) {
    return Result.err(WorkflowSessionCarryReason.PushingStepOnAuto);
  }
  const prefix = `${LOOP_STEP_WORK_DIR}/`;
  if (args.input.artifacts.some((path) => !path.startsWith(prefix))) {
    return Result.err(WorkflowSessionCarryReason.ArtifactsOutsideWorkDir);
  }
  const row = args.rows.find(
    (candidate) => candidate.id === args.sessionLoopId
  );
  const carried = row ? readCarriedWorkspaceMetadata(row.metadata) : null;
  if (carried) {
    return Result.ok(carried);
  }
  const slug = await ownDocumentSlug(
    row,
    args.previous,
    args.input.run.organizationId
  );
  if (slug === null) {
    return Result.err(WorkflowSessionCarryReason.WorkspaceUnknown);
  }
  return Result.ok({ slug, fromRunId: args.previous.id });
}

/** The slug of the loop's own run document; null for a case loop or a foreign document. */
async function ownDocumentSlug(
  row: StepLoopRow | undefined,
  previous: PreviousRun,
  organizationId: string
): Promise<string | null> {
  const documentId = row?.artifactId ?? null;
  if (
    row === undefined ||
    documentId === null ||
    hasOrchestratorTask(row.metadata) ||
    (documentId !== previous.featureDocumentId &&
      documentId !== previous.planDocumentId)
  ) {
    return null;
  }
  const artifact = await withDb((db) =>
    db.artifact.findFirst({
      where: { id: documentId, organizationId },
      select: { slug: true },
    })
  );
  return artifact?.slug ?? null;
}

function hasOrchestratorTask(metadata: unknown): boolean {
  return isRecord(metadata) && "orchestratorTaskId" in metadata;
}

/** The prompt: the instruction's slash command first, then pointers; never thread text. */
function carriedPrompt(instruction: string): string {
  const trimmed = instruction.trim();
  const command = LEADING_COMMAND_RE.exec(trimmed)?.[0] ?? null;
  const rest = command ? trimmed.slice(command.length).trim() : trimmed;
  const messagesPath = `$AGENTFLOW_WORKDIR/${LOOP_STEP_INPUTS_DIR}/${CARRIED_MESSAGES_FILE}`;
  const issuePath = `$AGENTFLOW_WORKDIR/${LoopStepFile.Issue}`;
  const body = prependUntrustedLoopInputPreamble(
    [
      "A new request on the same item. You answered earlier requests on this item in this conversation: the thread up to your last answer is already here.",
      `Read \`${messagesPath}\`: the messages written since and the new request.`,
      "## What to do",
      rest,
      `Read the issue file (\`${issuePath}\`) only if those messages are not enough; it holds the whole thread.`,
      "This request has its own output: write every file the instruction names again, now; files from an earlier request are not this run's.",
    ].join("\n\n")
  );
  return command ? `${command} ${body}` : body;
}

function renderMessages(delta: Delta, title: string): string {
  if (!delta.known) {
    return "The time of your last answer is not known. Read the issue file for the thread.";
  }
  const parts: string[] = [];
  if (delta.lines.length === 0) {
    parts.push("No new messages.");
  } else {
    parts.push(
      wrapUntrustedLoopArtifactContent(delta.lines.join("\n\n"), {
        artifactType: "Source item messages",
        title,
      })
    );
  }
  if (delta.dropped > 0) {
    parts.push(
      `${delta.dropped} earlier messages written since your last answer are left out here; they are in the issue file.`
    );
  }
  return parts.join("\n\n");
}

/** The messages between the two mentions, oldest first, newest kept within the cap. */
function messagesSince(input: {
  item: SourceItem;
  previous: { occurredAt: string | null; messageId: string | null };
  current: { occurredAt: string; messageId: string | null };
  ownCommentIds: ReadonlySet<string>;
}): Delta {
  const after = Date.parse(input.previous.occurredAt ?? "");
  const before = Date.parse(input.current.occurredAt);
  if (Number.isNaN(after)) {
    return { lines: [], dropped: 0, known: false };
  }
  const thread = input.item.thread;
  const source: readonly (SourceItemComment & { fromBot?: boolean })[] =
    thread ?? input.item.comments;
  const skipped = new Set<string>(
    [input.previous.messageId, input.current.messageId].filter(
      (id): id is string => id !== null
    )
  );
  const lines = source
    .filter((message) =>
      isNewMessage(message, {
        after,
        before,
        skipped,
        own: thread ? new Set<string>() : input.ownCommentIds,
      })
    )
    .map(
      (message) =>
        `**${message.author ?? "Someone"}** (${message.createdAt ?? "unknown time"}):\n\n${message.bodyMarkdown}`
    );
  return capDelta(lines);
}

function isNewMessage(
  message: SourceItemComment & { fromBot?: boolean },
  window: {
    after: number;
    before: number;
    skipped: ReadonlySet<string>;
    own: ReadonlySet<string>;
  }
): boolean {
  const time = Date.parse(message.createdAt ?? "");
  if (Number.isNaN(time) || time <= window.after || time >= window.before) {
    return false;
  }
  if (message.fromBot === true) {
    return false;
  }
  const id = message.id ?? null;
  return id === null || !(window.skipped.has(id) || window.own.has(id));
}

function capDelta(lines: string[]): Delta {
  let total = lines.reduce((sum, line) => sum + line.length + 2, -2);
  let dropped = 0;
  while (dropped < lines.length && total > CARRIED_DELTA_MAX) {
    total -= (lines[dropped]?.length ?? 0) + 2;
    dropped += 1;
  }
  return { lines: lines.slice(dropped), dropped, known: true };
}

/** The slash command an instruction starts with. */
const LEADING_COMMAND_RE = /^\/\S+/;
