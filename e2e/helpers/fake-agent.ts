import { randomUUID } from "node:crypto";
import type { RegisterComputeTargetResponse } from "@repo/api/src/types/compute-target";
import type { IntegrationToolCallResponse } from "@repo/api/src/types/integration-tools";
import {
  ORCHESTRATOR_SESSION_ROUTE,
  ORCHESTRATOR_TASK_REPLY_FILE,
  ORCHESTRATOR_TOOLS_CALL_ROUTE,
  ORCHESTRATOR_TURN_OPERATION_ID,
  type OrchestratorTurnRequest,
} from "@repo/api/src/types/orchestrator";
import { getApiBaseUrl } from "./api-url";

/**
 * An Agent (compute target) for e2e runs that answers the API the way the
 * headless runner does, without a computer or Claude: it listens on the
 * relay stream (GET /compute-targets/{id}/stream), runs an orchestrator turn
 * by exchanging it for the turn's tool token and calling the real tools
 * (POST /orchestrator-tools/call, what apps/mcp forwards to), and runs a
 * task's STEP loop by posting its events and step result with the loop's
 * runner token. What a turn or a task does is the test's script.
 */

const LOOP_COMMAND_OPERATION_ID = "symphony_loop";
const STREAM_RETRY_MS = 500;
/** Like the runner: a stale last-seen marks the Agent offline. */
const HEARTBEAT_MS = 15_000;

export type TurnContext = {
  request: OrchestratorTurnRequest;
  /** Calls one orchestrator tool; throws when the API refuses the call. */
  tool(name: string, input?: Record<string, unknown>): Promise<unknown>;
  /** Calls one tool and returns the API's answer as is (ok or refused). */
  toolResult(
    name: string,
    input?: Record<string, unknown>
  ): Promise<IntegrationToolCallResponse>;
};

export type TurnScript = (turn: TurnContext) => Promise<{ answer: string }>;

export type LoopBody = {
  loopId: string;
  agentFlowAuthToken: string;
  prompt: string | null;
  parentLoopId: string | null;
  step?: { stepId: string; forkSession?: boolean; readOnly?: boolean };
};

/**
 * A file the task leaves (a command's `attach` glob match). `path` is
 * relative to the workspace root, like the runner's. Without `content` it is
 * reported as not collected, with `skipped` as the reason.
 */
export type TaskAttachment = {
  path: string;
  content?: string | Uint8Array;
  skipped?: string;
  size?: number;
};

export type TaskOutcome = {
  questions?: { id: string; question: string; commentId?: string }[];
  reply?: string;
  attachments?: TaskAttachment[];
};

export type TaskScript = (loop: LoopBody) => Promise<TaskOutcome>;

export type ReceivedOperation = {
  operationId: string;
  body: unknown;
  receivedAt: Date;
};

export class FakeAgent {
  readonly id: string;
  readonly name: string;
  private readonly token: string;
  private readonly abort = new AbortController();
  private readonly turnScripts: TurnScript[] = [];
  private readonly taskScripts: TaskScript[] = [];
  private readonly received: ReceivedOperation[] = [];
  private readonly failures: string[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  private constructor(id: string, name: string, token: string) {
    this.id = id;
    this.name = name;
    this.token = token;
  }

  /** Registers an automatic Agent owned by the token's user. */
  static async register(token: string, name: string): Promise<FakeAgent> {
    const response = await fetch(
      `${getApiBaseUrl()}/compute-targets/register`,
      {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify({
          machineName: name,
          platform: "e2e",
          // Like the headless runner: it can fork a STEP loop's session.
          capabilities: { source: "fake-agent-e2e", loopStepForkSession: true },
          supportedOperations: ["loop.run"],
        }),
      }
    );
    const body = (await response.json()) as {
      success: boolean;
      data?: RegisterComputeTargetResponse;
      error?: string;
    };
    if (!(body.success && body.data)) {
      throw new Error(`Register ${name} failed: ${body.error}`);
    }
    return new FakeAgent(body.data.id, body.data.machineName, token);
  }

  /** Opens the relay stream; the Agent is online while it is open. */
  async connect(): Promise<void> {
    const ready = new Promise<void>((resolve) => {
      this.listen(resolve).catch((error: unknown) => {
        if (!this.abort.signal.aborted) {
          this.failures.push(`stream: ${String(error)}`);
        }
      });
    });
    await ready;
    this.heartbeat = setInterval(() => {
      fetch(`${getApiBaseUrl()}/compute-targets/${this.id}/heartbeat`, {
        method: "POST",
        headers: jsonHeaders(this.token),
      }).catch(() => undefined);
    }, HEARTBEAT_MS);
  }

  /** The next turn this Agent runs follows `script` (queued in order). */
  onTurn(script: TurnScript): void {
    this.turnScripts.push(script);
  }

  /** The next task (STEP loop) this Agent runs follows `script`. */
  onTask(script: TaskScript): void {
    this.taskScripts.push(script);
  }

  operations(operationId?: string): ReceivedOperation[] {
    return this.received.filter(
      (op) => operationId === undefined || op.operationId === operationId
    );
  }

  turns(): OrchestratorTurnRequest[] {
    return this.operations(ORCHESTRATOR_TURN_OPERATION_ID).map(
      (op) => op.body as OrchestratorTurnRequest
    );
  }

  loops(): LoopBody[] {
    return this.operations(LOOP_COMMAND_OPERATION_ID).map(
      (op) => op.body as LoopBody
    );
  }

  /** Errors raised while answering the API (a script threw, a post failed). */
  errors(): readonly string[] {
    return this.failures;
  }

  async disconnect(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }
    this.abort.abort();
    await Promise.resolve();
  }

  async delete(): Promise<void> {
    await this.disconnect();
    await fetch(`${getApiBaseUrl()}/compute-targets/${this.id}`, {
      method: "DELETE",
      headers: jsonHeaders(this.token),
    }).catch(() => undefined);
  }

  private async listen(onOpen: () => void): Promise<void> {
    let opened = false;
    while (!this.abort.signal.aborted) {
      const response = await fetch(
        `${getApiBaseUrl()}/compute-targets/${this.id}/stream`,
        {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: this.abort.signal,
        }
      ).catch(() => null);
      if (!(response?.ok && response.body)) {
        await sleep(STREAM_RETRY_MS);
        continue;
      }
      if (!opened) {
        opened = true;
        onOpen();
      }
      await this.readStream(response.body).catch(() => undefined);
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (data) {
          this.handle(data);
        }
        end = buffer.indexOf("\n\n");
      }
    }
  }

  private handle(data: string): void {
    let operation: {
      operationId: string;
      params?: { request?: { body?: unknown } };
    };
    try {
      operation = JSON.parse(data);
    } catch {
      return;
    }
    const body = operation.params?.request?.body ?? null;
    this.received.push({
      operationId: operation.operationId,
      body,
      receivedAt: new Date(),
    });
    const work = this.run(operation.operationId, body);
    work.catch((error: unknown) => {
      this.failures.push(
        `${operation.operationId}: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  private run(operationId: string, body: unknown): Promise<void> {
    if (operationId === ORCHESTRATOR_TURN_OPERATION_ID) {
      return this.runTurn(body as OrchestratorTurnRequest);
    }
    if (operationId === LOOP_COMMAND_OPERATION_ID) {
      return this.runTask(body as LoopBody);
    }
    return Promise.resolve();
  }

  private async runTurn(request: OrchestratorTurnRequest): Promise<void> {
    const script = this.turnScripts.shift();
    if (!script) {
      throw new Error(`No turn script for turn ${request.turnId}`);
    }
    const session = await this.api<{ token: string }>(
      `${ORCHESTRATOR_SESSION_ROUTE}?computeTargetId=${this.id}`,
      { turnId: request.turnId }
    );
    const toolResult = async (
      name: string,
      input: Record<string, unknown> = {}
    ): Promise<IntegrationToolCallResponse> => {
      const response = await fetch(
        `${getApiBaseUrl()}${ORCHESTRATOR_TOOLS_CALL_ROUTE}`,
        {
          method: "POST",
          headers: jsonHeaders(session.token),
          body: JSON.stringify({ tool: name, input }),
        }
      );
      const body = (await response.json()) as {
        success: boolean;
        data?: IntegrationToolCallResponse;
        error?: string;
      };
      if (!(body.success && body.data)) {
        throw new Error(`Tool ${name}: ${response.status} ${body.error}`);
      }
      return body.data;
    };
    const tool = async (name: string, input: Record<string, unknown> = {}) => {
      const result = await toolResult(name, input);
      if (!result.ok) {
        throw new Error(`Tool ${name} refused: ${result.error}`);
      }
      return result.output;
    };
    let outcome: { answer: string };
    try {
      outcome = await script({ request, tool, toolResult });
    } catch (error) {
      await this.postResult(ORCHESTRATOR_TURN_OPERATION_ID, {
        type: "result",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        retryable: false,
        sessionId: null,
      });
      throw error;
    }
    await this.postResult(ORCHESTRATOR_TURN_OPERATION_ID, {
      type: "result",
      ok: true,
      answer: outcome.answer,
      sessionId: request.sessionId ?? `session-${request.turnId}`,
      costUsd: 0.01,
      inputTokens: 100,
      outputTokens: 20,
    });
  }

  private async runTask(loop: LoopBody): Promise<void> {
    const script = this.taskScripts.shift();
    if (!script) {
      throw new Error(`No task script for loop ${loop.loopId}`);
    }
    const runner = { Authorization: `Bearer ${loop.agentFlowAuthToken}` };
    await this.loopEvent(loop, runner, { type: "started" });
    const outcome = await script(loop);
    const step = {
      stepId: loop.step?.stepId ?? "step",
      questions: outcome.questions ?? [],
      files: outcome.reply
        ? [
            {
              path: ORCHESTRATOR_TASK_REPLY_FILE,
              content: outcome.reply,
              truncated: false,
            },
          ]
        : [],
      questionsError: null,
      ...(outcome.attachments
        ? { attachments: outcome.attachments.map(toStepAttachment) }
        : {}),
    };
    const upload = await fetch(
      `${getApiBaseUrl()}/loops/${loop.loopId}/upload-artifacts`,
      {
        method: "POST",
        headers: { ...runner, "content-type": "application/json" },
        body: JSON.stringify({ artifacts: { step } }),
      }
    );
    if (!upload.ok) {
      throw new Error(
        `upload-artifacts ${upload.status}: ${await upload.text()}`
      );
    }
    await this.loopEvent(loop, runner, {
      type: "completed",
      result: { exitCode: 0, durationSeconds: 1 },
      tokensUsed: { input: 10, output: 5 },
    });
    await this.postResult(LOOP_COMMAND_OPERATION_ID, {
      ok: true,
      loopId: loop.loopId,
    });
  }

  private async loopEvent(
    loop: LoopBody,
    headers: Record<string, string>,
    event: Record<string, unknown>
  ): Promise<void> {
    const response = await fetch(
      `${getApiBaseUrl()}/loops/${loop.loopId}/events`,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "x-loop-event-nonce": randomUUID(),
        },
        body: JSON.stringify({
          ...event,
          loopId: loop.loopId,
          timestamp: new Date().toISOString(),
        }),
      }
    );
    if (!response.ok) {
      throw new Error(
        `loop event ${String(event.type)} ${response.status}: ${await response.text()}`
      );
    }
  }

  private async postResult(
    operationId: string,
    result: Record<string, unknown>
  ): Promise<void> {
    const response = await fetch(
      `${getApiBaseUrl()}/compute-targets/${this.id}/results`,
      {
        method: "POST",
        headers: jsonHeaders(this.token),
        body: JSON.stringify({ operationId, result }),
      }
    );
    if (!response.ok) {
      throw new Error(`results ${response.status}: ${await response.text()}`);
    }
  }

  private async api<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method: "POST",
      headers: jsonHeaders(this.token),
      body: JSON.stringify(body),
    });
    const parsed = (await response.json()) as {
      success: boolean;
      data?: T;
      error?: string;
    };
    if (!(parsed.success && parsed.data)) {
      throw new Error(`${path}: ${response.status} ${parsed.error}`);
    }
    return parsed.data;
  }
}

function jsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

/** Like the runner: the bytes go base64 in `data`, a file not collected says why. */
function toStepAttachment(attachment: TaskAttachment): Record<string, unknown> {
  if (attachment.content === undefined) {
    return {
      path: attachment.path,
      size: attachment.size ?? 0,
      skipped: attachment.skipped ?? "not collected",
    };
  }
  const bytes = Buffer.from(attachment.content);
  return {
    path: attachment.path,
    size: bytes.byteLength,
    data: bytes.toString("base64"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
