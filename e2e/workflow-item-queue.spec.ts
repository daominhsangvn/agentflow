/**
 * The item queue and session carry-over of a process-mode workflow
 * (`agent.sameItem: queue_resume`, docs/workflows.md "Item queue") on the
 * local stack, with a fake Jira site and fake Agents instead of Jira, computers
 * and Claude (helpers/fake-jira.ts, helpers/fake-agent.ts). The API, its engine
 * tick, the item lock, the database and the loops are real; the fake Agents
 * follow one script queue (helpers/item-queue-flow-env.ts).
 *
 * Covers Q2-Q7, R1, R2, R4 and R9 of the test plan. Not covered here (manual):
 * a real Claude session, the working directory lookup and Teams.
 *
 * E2E_KEEP_DATA=1 keeps the project, workflow and runs afterwards.
 */

import { LoopErrorCode } from "@repo/api/src/types/loop";
import { WorkflowRunStatus } from "@repo/api/src/types/workflow";
import { WorkflowEventResult } from "@repo/api/src/types/workflow-event";
import {
  WorkflowSessionCarryAttempt,
  WorkflowSessionCarryReason,
} from "@repo/api/src/types/workflow-same-item";
import { isOrgAdminRole, requireOrgClaims } from "./helpers/better-auth";
import { readEnv } from "./helpers/env";
import {
  ANSWER_REPLY_PATH,
  ANSWER_STEP_ID,
  createGate,
  ItemQueueEnv,
  type QueueSnapshot,
  type RunView,
} from "./helpers/item-queue-flow-env";
import { expect, test } from "./test";

const ADMIN_REQUIRED_MESSAGE =
  "The e2e user must be an org admin to set up connections and workflows";
const TEST_TIMEOUT_MS = 10 * 60_000;

const PLAIN_COMMENT = "PLAIN-REMARK between the mentions";
const QUESTION_ONE = "QUESTION-ONE";
const QUESTION_TWO = "QUESTION-TWO";
const QUESTION_THREE = "QUESTION-THREE";
const REPLY_ONE = "REPLY-ONE";
const REPLY_TWO = "REPLY-TWO";
const REPLY_THREE = "REPLY-THREE";
const SESSION_ONE = "e2e-session-one";
const SESSION_TWO = "e2e-session-two";
const SESSION_THREE = "e2e-session-three";
const SESSION_FAILED = "e2e-session-failed";
const SESSION_FRESH = "e2e-session-fresh";
const NEW_MESSAGES_FILE = "new-messages.md";
const COMMAND_PREFIX = "/ask ";
const RENDERED_INSTRUCTION_PREFIX = "/ask Answer the mention in";

/** Event results the tests read (a comment that does not mention the bot has none of these). */
const QUEUE_RESULTS: readonly WorkflowEventResult[] = [
  WorkflowEventResult.Created,
  WorkflowEventResult.Queued,
  WorkflowEventResult.Duplicate,
];

test.describe("workflow item queue and session carry-over", () => {
  test("queues mentions of one item and resumes the earlier run's session (Q2, Q4, Q5, R1, R9)", async ({
    apiToken: token,
    request,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const env = startEnv(token, request);
    try {
      await env.setUp();
      const issue = env.newIssue();
      const gate = createGate();
      env.script(async () => {
        await gate.wait;
        return answer(REPLY_ONE, SESSION_ONE);
      });
      env.script(() => Promise.resolve(answer(REPLY_TWO, SESSION_TWO)));
      env.script(() => Promise.resolve(answer(REPLY_THREE, SESSION_THREE)));

      await env.mention(issue, QUESTION_ONE);
      await env.waitFor("loop 1 started", () => env.startedLoops() === 1);
      await env.plainComment(issue, PLAIN_COMMENT);
      const second = await env.mention(issue, QUESTION_TWO);
      await env.waitFor("run 2 received", (s) => s.runs.length === 2);
      await env.mention(issue, QUESTION_THREE);
      await env.deliver(second);
      const queued = await env.waitFor(
        "runs 2 and 3 queued behind run 1, redelivery recorded",
        (s) =>
          s.runs.length === 3 &&
          waits(s.runs[1]) &&
          waits(s.runs[2]) &&
          queueResults(s).length === 4
      );

      // Q2, Q4, Q5: run 1 holds its loop; the others wait, both on run 1.
      const [run1, run2, run3] = queued.runs as [RunView, RunView, RunView];
      expect(queueResults(queued)).toEqual([
        WorkflowEventResult.Created,
        WorkflowEventResult.Queued,
        WorkflowEventResult.Queued,
        WorkflowEventResult.Duplicate,
      ]);
      expect(env.startedLoops()).toBe(1);
      expect(run1.summary.status).toBe(WorkflowRunStatus.Running);
      expect(run2.detail.queuedBehind?.runId).toBe(run1.summary.id);
      // The holder is the run of the item that has started, not the run just ahead.
      expect(run3.detail.queuedBehind?.runId).toBe(run1.summary.id);

      gate.open();
      const done = await env.waitFor(
        "three runs succeeded and three replies posted",
        (s) =>
          s.runs.length === 3 &&
          s.runs.every(
            (run) => run.summary.status === WorkflowRunStatus.Succeeded
          ) &&
          env.postedOn(issue).length === 3
      );

      const loopIds = done.runs.map((run) => stepLoopIds(run));
      expect(loopIds.map((ids) => ids.length)).toEqual([1, 1, 1]);
      const [loop1, loop2, loop3] = loopIds.map((ids) => ids[0] ?? "");
      expect(env.loopsOverlap([loop1, loop2, loop3])).toBe(false);

      // R1: run 2 resumes run 1's session on the same Agent with a short prompt.
      const body2 = env.loopBody(loop2);
      expect(body2.parentLoopId).toBe(loop1);
      expect(body2.step?.forkSession ?? false).toBe(false);
      expect(body2.step?.fresh).toBe(true);
      expect(body2.step?.reportResumeMiss).toBe(true);
      expect(body2.prompt?.startsWith(COMMAND_PREFIX)).toBe(true);
      expect(body2.prompt).not.toContain(PLAIN_COMMENT);
      const messages = body2.step?.inputs?.find(
        (input) => input.name === NEW_MESSAGES_FILE
      )?.content;
      expect(messages).toContain(PLAIN_COMMENT);
      expect(messages).toContain(QUESTION_TWO);
      expect(messages).not.toContain(QUESTION_ONE);
      expect(messages).not.toContain(QUESTION_THREE);
      expect(env.loopRecord(loop2).agent).toBe(env.loopRecord(loop1).agent);
      expect(done.runs[1]?.detail.sessionCarry).toEqual({
        fromRunId: run1.summary.id,
        attempt: WorkflowSessionCarryAttempt.Resume,
        reason: null,
      });

      // R9: run 3 resumes run 2's session, which itself resumed run 1's.
      const body3 = env.loopBody(loop3);
      expect(body3.parentLoopId).toBe(loop2);
      expect(body3.step?.forkSession ?? false).toBe(false);
      expect(done.runs[2]?.detail.sessionCarry).toEqual({
        fromRunId: run2.summary.id,
        attempt: WorkflowSessionCarryAttempt.Resume,
        reason: null,
      });
      const messagesThree = body3.step?.inputs?.find(
        (input) => input.name === NEW_MESSAGES_FILE
      )?.content;
      expect(messagesThree).toContain(QUESTION_THREE);
      expect(messagesThree).not.toContain(PLAIN_COMMENT);

      // The replies came back in run order, one per run.
      const posted = env.postedOn(issue);
      expect(posted[0]).toContain(REPLY_ONE);
      expect(posted[1]).toContain(REPLY_TWO);
      expect(posted[2]).toContain(REPLY_THREE);
      env.expectNoAgentErrors();
    } finally {
      await finish(env);
    }
  });

  test("runs another item's mention at once (Q3)", async ({
    apiToken: token,
    request,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const env = startEnv(token, request);
    try {
      await env.setUp();
      const first = env.newIssue();
      const other = env.newIssue();
      const gate = createGate();
      env.script(async () => {
        await gate.wait;
        return answer(REPLY_ONE, SESSION_ONE);
      });
      env.script(() => Promise.resolve(answer(REPLY_TWO, SESSION_TWO)));

      await env.mention(first, QUESTION_ONE);
      await env.waitFor(
        "loop of item 1 started",
        () => env.startedLoops() === 1
      );
      await env.mention(other, QUESTION_TWO);
      await env.waitFor(
        "loop of item 2 started while item 1's loop is held",
        () => env.startedLoops() === 2
      );
      const [held, parallel] = env.loopRecords();
      expect(held?.endedAt).toBeNull();

      gate.open();
      const done = await env.waitFor("both runs succeeded", (s) =>
        allSucceeded(s, 2)
      );
      const ofOther = done.runs.find(
        (run) => run.summary.source.key === other.key
      );
      expect(ofOther?.detail.queuedBehind).toBeNull();
      expect(held?.endedAt).toBeGreaterThan(
        parallel?.startedAt ?? Number.POSITIVE_INFINITY
      );
      env.expectNoAgentErrors();
    } finally {
      await finish(env);
    }
  });

  test("two mentions at the same moment never run together (Q6)", async ({
    apiToken: token,
    request,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const env = startEnv(token, request);
    try {
      await env.setUp();
      const issue = env.newIssue();
      const gate = createGate();
      env.script(async () => {
        await gate.wait;
        return answer(REPLY_ONE, SESSION_ONE);
      });
      env.script(() => Promise.resolve(answer(REPLY_TWO, SESSION_TWO)));

      await Promise.all([
        env.mention(issue, QUESTION_ONE),
        env.mention(issue, QUESTION_TWO),
      ]);
      const queued = await env.waitFor(
        "two runs, the second waiting for the first",
        (s) => s.runs.length === 2 && waits(s.runs[1])
      );
      expect(env.startedLoops()).toBeLessThanOrEqual(1);
      expect(queued.runs[1]?.detail.queuedBehind?.runId).toBe(
        queued.runs[0]?.summary.id
      );

      gate.open();
      const done = await env.waitFor(
        "both runs succeeded and both replies posted",
        (s) => allSucceeded(s, 2) && env.postedOn(issue).length === 2
      );
      const loops = done.runs.map((run) => stepLoopIds(run)[0] ?? "");
      expect(env.loopsOverlap(loops)).toBe(false);
      // The run created first started first and was answered first.
      expect(env.loopRecords()[0]?.loopId).toBe(loops[0]);
      const posted = env.postedOn(issue);
      expect(posted[0]).toContain(REPLY_ONE);
      expect(posted[1]).toContain(REPLY_TWO);
      env.expectNoAgentErrors();
    } finally {
      await finish(env);
    }
  });

  test("a failed run does not block the queue; a missing session falls back to a fork, then a fresh session; an offline Agent starts fresh (Q7, R4, R2)", async ({
    apiToken: token,
    request,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const env = startEnv(token, request);
    try {
      const { agentA, agentB } = await env.setUp();
      const issue = env.newIssue();
      const gate = createGate();
      env.script(async () => {
        await gate.wait;
        return {
          fail: {
            code: LoopErrorCode.ProcessFailed,
            message: "The agent failed",
          },
          sessionId: SESSION_FAILED,
        };
      });
      const notFound = {
        fail: {
          code: LoopErrorCode.ResumeSessionNotFound,
          message: "No conversation found with that session id",
        },
      };
      env.script(() => Promise.resolve(notFound));
      env.script(() => Promise.resolve(notFound));
      env.script(() => Promise.resolve(answer(REPLY_TWO, SESSION_FRESH)));

      await env.mention(issue, QUESTION_ONE);
      await env.waitFor("loop 1 started", () => env.startedLoops() === 1);
      await env.mention(issue, QUESTION_TWO);
      await env.waitFor(
        "run 2 queued behind run 1",
        (s) => s.runs.length === 2 && waits(s.runs[1])
      );
      gate.open();

      // Q7: run 1 failed; run 2 started anyway.
      const second = await env.waitFor(
        "run 1 failed and run 2 succeeded after its fallbacks",
        (s) =>
          s.runs.length === 2 &&
          s.runs[0]?.summary.status === WorkflowRunStatus.Failed &&
          s.runs[1]?.summary.status === WorkflowRunStatus.Succeeded
      );
      const [run1, run2] = second.runs as [RunView, RunView];
      const records = env.loopRecords();
      expect(records).toHaveLength(4);
      const [loop1, resume, fork, fresh] = records.map((r) => r.loopId) as [
        string,
        string,
        string,
        string,
      ];

      // R4: resume, then fork, then fresh with the whole instruction.
      const resumeBody = env.loopBody(resume);
      expect(resumeBody.parentLoopId).toBe(loop1);
      expect(resumeBody.step?.forkSession ?? false).toBe(false);
      const forkBody = env.loopBody(fork);
      expect(forkBody.parentLoopId).toBe(loop1);
      expect(forkBody.step?.forkSession).toBe(true);
      const freshBody = env.loopBody(fresh);
      expect(freshBody.parentLoopId).toBeNull();
      expect(freshBody.step?.forkSession ?? false).toBe(false);
      expect(freshBody.prompt?.startsWith(RENDERED_INSTRUCTION_PREFIX)).toBe(
        true
      );
      expect(freshBody.step?.inputs ?? []).toEqual([]);
      expect(run2.detail.sessionCarry).toEqual({
        fromRunId: run1.summary.id,
        attempt: WorkflowSessionCarryAttempt.Fresh,
        reason: WorkflowSessionCarryReason.ForkSessionNotFound,
      });
      expect(env.loopsOverlap([loop1, resume, fork, fresh])).toBe(false);

      // R2: the Agent that ran run 2 goes offline; run 3 starts fresh on the other one.
      const offline = env.loopRecord(fresh).agent;
      const other = offline.id === agentA.id ? agentB : agentA;
      await offline.disconnect();
      env.script((_loop, agent) => {
        expect(agent.id).toBe(other.id);
        return Promise.resolve(answer(REPLY_THREE, SESSION_THREE));
      });
      await env.mention(issue, QUESTION_THREE);
      const third = await env.waitFor(
        "run 3 succeeded on the other Agent",
        (s) =>
          s.runs.length === 3 &&
          s.runs[2]?.summary.status === WorkflowRunStatus.Succeeded
      );
      const loop3 = stepLoopIds(third.runs[2] as RunView)[0] ?? "";
      expect(env.loopRecord(loop3).agent.id).toBe(other.id);
      expect(env.loopBody(loop3).parentLoopId).toBeNull();
      expect(third.runs[2]?.detail.sessionCarry).toEqual({
        fromRunId: run2.summary.id,
        attempt: WorkflowSessionCarryAttempt.Fresh,
        reason: WorkflowSessionCarryReason.RunnerUnavailable,
      });
      env.expectNoAgentErrors();
    } finally {
      await finish(env);
    }
  });
});

function startEnv(
  token: string,
  request: ConstructorParameters<typeof ItemQueueEnv>[0]
): ItemQueueEnv {
  const { orgRole } = requireOrgClaims(token);
  expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);
  return new ItemQueueEnv(request, token);
}

async function finish(env: ItemQueueEnv): Promise<void> {
  await env.cleanUp(readEnv("E2E_KEEP_DATA") === "1");
}

/** What an agent step's script returns: the reply file and the recorded session. */
function answer(reply: string, sessionId: string) {
  return { reply, replyPath: ANSWER_REPLY_PATH, sessionId };
}

/**
 * The run is received and waits for an earlier run of its item. The waiting
 * reason is `detail.queuedBehind`; the summary's error stays null.
 */
function waits(run: RunView | undefined): boolean {
  return (
    run?.summary.status === WorkflowRunStatus.Received &&
    run.detail.queuedBehind != null
  );
}

/** Results of the events that start or queue a run, oldest first. */
function queueResults(snapshot: QueueSnapshot): WorkflowEventResult[] {
  return snapshot.events
    .map((event) => event.result)
    .filter((result) => QUEUE_RESULTS.includes(result));
}

function stepLoopIds(run: RunView): string[] {
  return run.detail.loops
    .filter((loop) => loop.stepId === ANSWER_STEP_ID)
    .map((loop) => loop.loopId);
}

function allSucceeded(snapshot: QueueSnapshot, count: number): boolean {
  return (
    snapshot.runs.length === count &&
    snapshot.runs.every(
      (run) => run.summary.status === WorkflowRunStatus.Succeeded
    )
  );
}
