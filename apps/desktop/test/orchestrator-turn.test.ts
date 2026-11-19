import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  ORCHESTRATOR_TURN_CANCEL_OPERATION_ID,
  ORCHESTRATOR_TURN_OPERATION_ID,
} from "@repo/api/src/types/orchestrator";
import { HEADLESS_RUNNER_OPERATION_IDS } from "../src/headless/headless-commands.js";
import { resolveOperationId } from "../src/main/approvals/approval-operations.js";
import {
  ORCHESTRATOR_ALLOWED_TOOLS,
  orchestratorTurnArgs,
  readTurnResult,
  resolveOrchestratorFolder,
  spawnResumingSession,
  stopRunningTurn,
} from "../src/server/operations/orchestrator-turn.js";

const EXIT_CODE_RE = /\(exit code 1\): boom/;
const EXIT = { code: 0, stderr: "", timedOut: false, timeoutMs: 600_000 };

test("a turn has only the orchestrator's tools and resumes the conversation's session", () => {
  const args = orchestratorTurnArgs("/tmp/mcp.json", "session-1");
  assert.ok(args.includes(`--allowedTools=${ORCHESTRATOR_ALLOWED_TOOLS}`));
  assert.equal(ORCHESTRATOR_ALLOWED_TOOLS, "mcp__agentflow_orchestrator");
  const denied = args.find((arg) => arg.startsWith("--disallowedTools="));
  for (const tool of ["Bash", "Read", "Write", "Edit", "WebFetch", "Task"]) {
    assert.ok(denied?.split("=")[1]?.split(",").includes(tool), tool);
  }
  assert.ok(args.includes("--strict-mcp-config"));
  assert.deepEqual(args.slice(-2), ["--resume", "session-1"]);
});

test("a first turn starts a new session", () => {
  assert.ok(!orchestratorTurnArgs("/tmp/mcp.json", null).includes("--resume"));
});

test("sessions live in one folder per project", () => {
  assert.equal(
    resolveOrchestratorFolder("project-1", ["/work"]),
    path.join("/work", ".agentflow-ai", "orchestrator", "project-1")
  );
  assert.throws(() => resolveOrchestratorFolder("project-1", []));
});

test("the result carries the note, the session and the usage", () => {
  const result = readTurnResult(
    {
      resultLine: {
        type: "result",
        result: "Answered from the policy.",
        session_id: "session-2",
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 50,
          output_tokens: 20,
        },
      },
      sessionId: "session-1",
    },
    EXIT
  );
  assert.deepEqual(result, {
    type: "result",
    ok: true,
    answer: "Answered from the policy.",
    sessionId: "session-2",
    costUsd: 0.01,
    inputTokens: 150,
    outputTokens: 20,
  });
});

test("a turn that timed out or gave no answer fails, keeping its session", () => {
  const timedOut = readTurnResult(
    { resultLine: null, sessionId: "session-1" },
    { ...EXIT, timedOut: true }
  );
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.sessionId, "session-1");
  const silent = readTurnResult(
    { resultLine: null, sessionId: null },
    { ...EXIT, code: 1, stderr: "boom" }
  );
  assert.equal(silent.ok, false);
  assert.match(silent.ok ? "" : silent.error, EXIT_CODE_RE);
});

test("the turn is an operation a headless runner runs", () => {
  assert.equal(
    resolveOperationId("/api/gateway/orchestrator/turn"),
    ORCHESTRATOR_TURN_OPERATION_ID
  );
  assert.ok(
    (HEADLESS_RUNNER_OPERATION_IDS as readonly string[]).includes(
      ORCHESTRATOR_TURN_OPERATION_ID
    )
  );
});

test("stopping a turn that does not run here says so", () => {
  assert.equal(stopRunningTurn("0199a5f0-0000-7000-8000-0000000000aa"), false);
});

test("stopping a turn is an operation a headless runner runs", () => {
  assert.equal(
    resolveOperationId("/api/gateway/orchestrator/turn/cancel"),
    ORCHESTRATOR_TURN_CANCEL_OPERATION_ID
  );
  assert.ok(
    (HEADLESS_RUNNER_OPERATION_IDS as readonly string[]).includes(
      ORCHESTRATOR_TURN_CANCEL_OPERATION_ID
    )
  );
});

function resumeHarness(options: {
  sessionId: string | null;
  missing: boolean[];
  stopped?: boolean;
  reopenFails?: boolean;
  reopenFailsOnce?: boolean;
}) {
  const calls: [string | null, string][] = [];
  let reopened = 0;
  const grantOf = (token: string) => ({
    token,
    expiresAt: "2026-10-13T09:00:00.000Z",
    mcpUrl: "http://localhost:3010/mcp",
    filesUrl: "http://localhost:3002/integration-tools/files",
  });
  const run = () =>
    spawnResumingSession({
      sessionId: options.sessionId,
      grant: grantOf("ost_a"),
      spawn: (sessionId, grant) => {
        calls.push([sessionId, grant.token]);
        return Promise.resolve({
          missingSession: options.missing.shift() ?? false,
        });
      },
      reopenFresh: () => {
        reopened += 1;
        if (options.reopenFailsOnce && reopened === 1) {
          return Promise.reject(new Error("blip"));
        }
        return options.reopenFails
          ? Promise.reject(new Error("down"))
          : Promise.resolve(grantOf("ost_b"));
      },
      stopped: () => options.stopped ?? false,
    });
  return { calls, run, reopened: () => reopened };
}

test("a session this computer no longer has starts fresh after a fresh-session exchange", async () => {
  const h = resumeHarness({ sessionId: "s-1", missing: [true, false] });
  await h.run();
  assert.deepEqual(h.calls, [
    ["s-1", "ost_a"],
    [null, "ost_b"],
  ]);
  assert.equal(h.reopened(), 1);
});

test("a resumed session is not exchanged again", async () => {
  const h = resumeHarness({ sessionId: "s-1", missing: [false] });
  await h.run();
  assert.deepEqual(h.calls, [["s-1", "ost_a"]]);
  assert.equal(h.reopened(), 0);
});

test("a first turn starts once", async () => {
  const h = resumeHarness({ sessionId: null, missing: [true] });
  await h.run();
  assert.deepEqual(h.calls, [[null, "ost_a"]]);
  assert.equal(h.reopened(), 0);
});

test("a stopped turn is not restarted", async () => {
  const h = resumeHarness({ sessionId: "s-1", missing: [true], stopped: true });
  await h.run();
  assert.deepEqual(h.calls, [["s-1", "ost_a"]]);
  assert.equal(h.reopened(), 0);
});

test("a failed exchange is retried once and the fresh session gets the new token", async () => {
  const h = resumeHarness({
    sessionId: "s-1",
    missing: [true, false],
    reopenFailsOnce: true,
  });
  await h.run();
  assert.deepEqual(h.calls, [
    ["s-1", "ost_a"],
    [null, "ost_b"],
  ]);
  assert.equal(h.reopened(), 2);
});

test("the fresh session keeps the first token when the exchange fails", async () => {
  const h = resumeHarness({
    sessionId: "s-1",
    missing: [true, false],
    reopenFails: true,
  });
  await h.run();
  assert.deepEqual(h.calls, [
    ["s-1", "ost_a"],
    [null, "ost_a"],
  ]);
});
