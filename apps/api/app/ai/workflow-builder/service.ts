import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type InferUITools,
  safeValidateUIMessages,
  type UIDataTypes,
  type UIMessage,
  type UIMessageStreamWriter,
} from "@repo/ai";
import { Result } from "@repo/api/src/types/result";
import {
  WorkflowBuilderDisabledReason,
  WorkflowBuilderErrorCode,
  type WorkflowBuilderStatus,
  WorkflowBuilderToolName,
} from "@repo/api/src/types/workflow-builder";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import { z } from "zod";
import { env } from "@/env";
import { FixedWindowRateLimiter } from "@/lib/fixed-window-rate-limiter";
import {
  type ClaudeCodeCommand,
  type ClaudeCodeResolution,
  createClaudeCodeResolver,
} from "@/lib/platform-agent/claude-code";
import { RunEnd } from "@/lib/platform-agent/cli-runner";
import {
  createRunSlots,
  PLATFORM_AGENT_MAX_CONCURRENT_RUNS,
} from "@/lib/platform-agent/run-slots";
import {
  createPlatformAgentSettingsLoader,
  type PlatformAgentSettings,
} from "@/lib/platform-agent/settings";
import { AgentRunOutcome } from "@/lib/platform-agent/stream-json";
import { scheduleLogFlush } from "@/lib/route-utils";
import {
  loadWorkflowBuilderCatalog,
  type WorkflowBuilderCaller,
} from "./service/catalog-tool";
import {
  runWorkflowBuilderChat,
  type WorkflowBuilderChatRunResult,
} from "./service/chat-run";
import {
  createKnowledgeLoader,
  type KnowledgeGuide,
} from "./service/knowledge";
import { proposeWorkflowTool } from "./service/prompt";

export type WorkflowBuilderChatFailure = {
  status: 400 | 429 | 503;
  code?: string;
  message: string;
  retryAfterSeconds?: number;
};

export type WorkflowBuilderStreamChatInput = {
  caller: WorkflowBuilderCaller;
  messages: unknown[];
  editorYaml: string;
  workflowId?: string;
  abortSignal?: AbortSignal;
};

const CHAT_RATE_LIMIT_MAX_REQUESTS = 30;
const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;
const CHAT_RATE_LIMIT_MAX_ENTRIES = 5000;
const CHAT_BUSY_RETRY_SECONDS = 15;
const STREAM_ERROR_MESSAGE =
  "The workflow assistant could not answer. Try again.";
const STREAM_TIMEOUT_MESSAGE = "The assistant took too long. Try again.";

const CliFailureReason = {
  ResultError: "cli_result_error",
  NoResult: "cli_no_result",
  ExitNonzero: "cli_exit_nonzero",
  SpawnFailed: "cli_spawn_failed",
  Timeout: "cli_timeout",
} as const;
type CliFailureReason =
  (typeof CliFailureReason)[keyof typeof CliFailureReason];

const VALIDATION_TOOLS = {
  [WorkflowBuilderToolName.ProposeWorkflow]: proposeWorkflowTool,
};
type WorkflowBuilderUiMessage = UIMessage<
  unknown,
  UIDataTypes,
  InferUITools<typeof VALIDATION_TOOLS>
>;

const settingsLoader = createPlatformAgentSettingsLoader();
const knowledgeLoader = createKnowledgeLoader();
const chatLimiter = new FixedWindowRateLimiter({
  maxRequests: CHAT_RATE_LIMIT_MAX_REQUESTS,
  windowMs: CHAT_RATE_LIMIT_WINDOW_MS,
  maxEntries: CHAT_RATE_LIMIT_MAX_ENTRIES,
});
const claudeCodeResolver = createClaudeCodeResolver();
// Per-process concurrency cap for platform agent runs. Move it (with the loader and resolver
// above) into a shared engine composition when a second consumer appears.
const runSlots = createRunSlots(PLATFORM_AGENT_MAX_CONCURRENT_RUNS);

export const workflowBuilderService = {
  async getStatus(): Promise<WorkflowBuilderStatus> {
    const settingsFile = env.PLATFORM_AGENT_SETTINGS_FILE;
    if (!settingsFile) {
      return {
        enabled: false,
        reason: WorkflowBuilderDisabledReason.NotConfigured,
      };
    }
    const settings = await settingsLoader.load(settingsFile);
    if (!settings.ok) {
      return { enabled: false, reason: settings.reason };
    }
    const claudeCode = await resolveClaudeCode();
    return claudeCode.ok
      ? { enabled: true }
      : { enabled: false, reason: claudeCode.reason };
  },

  streamChat(
    input: WorkflowBuilderStreamChatInput
  ): Promise<Result<Response, WorkflowBuilderChatFailure>> {
    const { caller } = input;
    return withSpan(
      "workflow_builder.chat",
      {
        [AfAttribute.OrgId]: caller.organizationId,
        [AfAttribute.UserId]: caller.userId,
      },
      () => streamChat(input)
    );
  },
};

async function streamChat(
  input: WorkflowBuilderStreamChatInput
): Promise<Result<Response, WorkflowBuilderChatFailure>> {
  const { caller } = input;
  const settingsFile = env.PLATFORM_AGENT_SETTINGS_FILE;
  if (!settingsFile) {
    setSpanOutcome(
      AfOutcome.Error,
      WorkflowBuilderDisabledReason.NotConfigured
    );
    return Result.err({
      status: 503,
      code: WorkflowBuilderErrorCode.NotConfigured,
      message: "The workflow assistant is not configured.",
    });
  }
  const settings = await settingsLoader.load(settingsFile);
  if (!settings.ok) {
    setSpanOutcome(AfOutcome.Error, settings.reason);
    return Result.err(unavailableFailure());
  }
  const claudeCode = await resolveClaudeCode();
  if (!claudeCode.ok) {
    setSpanOutcome(AfOutcome.Error, claudeCode.reason);
    return Result.err(unavailableFailure());
  }

  const limiterKey = `${caller.organizationId}:${caller.userId}`;
  if (!chatLimiter.attempt(limiterKey, Date.now())) {
    setSpanOutcome(AfOutcome.Error, "rate_limited");
    return Result.err({
      status: 429,
      code: WorkflowBuilderErrorCode.RateLimited,
      message: "Too many requests. Try again in a minute.",
      retryAfterSeconds: CHAT_RATE_LIMIT_WINDOW_MS / 1000,
    });
  }

  const validated = await safeValidateUIMessages<WorkflowBuilderUiMessage>({
    messages: dropUnfinishedReadParts(input.messages),
    tools: VALIDATION_TOOLS,
  });
  if (!validated.success) {
    setSpanOutcome(AfOutcome.Error, "invalid_messages");
    return Result.err({ status: 400, message: "Invalid messages payload" });
  }

  const release = runSlots.tryAcquire();
  if (!release) {
    setSpanOutcome(AfOutcome.Error, "busy");
    return Result.err({
      status: 429,
      code: WorkflowBuilderErrorCode.Busy,
      message: "The assistant is busy. Try again shortly.",
      retryAfterSeconds: CHAT_BUSY_RETRY_SECONDS,
    });
  }

  try {
    const knowledge = await knowledgeLoader.load();
    const catalog = await loadWorkflowBuilderCatalog(caller);
    const stream = createUIMessageStream({
      originalMessages: validated.data,
      onError: () => STREAM_ERROR_MESSAGE,
      execute: ({ writer }) =>
        runInSpan({
          writer,
          release,
          caller,
          command: claudeCode.command,
          settings: settings.settings,
          guides: knowledge.ok ? knowledge.guides : [],
          catalog,
          messages: validated.data,
          editorYaml: input.editorYaml,
          abortSignal: input.abortSignal,
        }),
    });
    return Result.ok(createUIMessageStreamResponse({ stream }));
  } catch (error) {
    release();
    throw error;
  }
}

const messageWithPartsSchema = z.looseObject({ parts: z.array(z.unknown()) });
const toolPartSchema = z.looseObject({
  type: z.string(),
  state: z.string().optional(),
});
const FINISHED_TOOL_STATES: readonly string[] = [
  "output-available",
  "output-error",
  "output-denied",
];

/**
 * A chat stored in a browser can hold a read-only tool part (`read_guide`, `get_catalog`) that never
 * got its output because the run was stopped or timed out. Validation rejects such a part, so
 * drop every tool part other than `propose_workflow` that has no output. Messages that end up
 * without parts are dropped too.
 */
export function dropUnfinishedReadParts(messages: unknown[]): unknown[] {
  const proposeType = `tool-${WorkflowBuilderToolName.ProposeWorkflow}`;
  const kept: unknown[] = [];
  for (const message of messages) {
    const parsed = messageWithPartsSchema.safeParse(message);
    if (!parsed.success) {
      kept.push(message);
      continue;
    }
    const parts = parsed.data.parts.filter((part) => {
      const tool = toolPartSchema.safeParse(part);
      if (!(tool.success && tool.data.type.startsWith("tool-"))) {
        return true;
      }
      return (
        tool.data.type === proposeType ||
        FINISHED_TOOL_STATES.includes(tool.data.state ?? "")
      );
    });
    if (parts.length === parsed.data.parts.length) {
      kept.push(message);
    } else if (parts.length > 0) {
      kept.push({ ...parsed.data, parts });
    }
  }
  return kept;
}

function resolveClaudeCode(): Promise<ClaudeCodeResolution> {
  return claudeCodeResolver.resolve({
    requested: env.PLATFORM_AGENT_CLAUDE_CODE_VERSION,
    explicitPath: env.PLATFORM_AGENT_CLAUDE_CODE_PATH,
  });
}

function unavailableFailure(): WorkflowBuilderChatFailure {
  return {
    status: 503,
    code: WorkflowBuilderErrorCode.Unavailable,
    message: "The workflow assistant is unavailable.",
  };
}

type CliRunInput = {
  writer: UIMessageStreamWriter;
  release: () => void;
  caller: WorkflowBuilderCaller;
  command: ClaudeCodeCommand;
  settings: PlatformAgentSettings;
  guides: KnowledgeGuide[];
  catalog: unknown;
  messages: UIMessage[];
  editorYaml: string;
  abortSignal?: AbortSignal;
};

function runInSpan(input: CliRunInput): Promise<void> {
  const { caller } = input;
  return withSpan(
    "workflow_builder.cli_run",
    {
      [AfAttribute.OrgId]: caller.organizationId,
      [AfAttribute.UserId]: caller.userId,
    },
    async () => {
      try {
        const run = await runWorkflowBuilderChat({
          command: input.command,
          settingsEnv: input.settings.env,
          guides: input.guides,
          catalog: input.catalog,
          messages: input.messages,
          editorYaml: input.editorYaml,
          write: (chunk) => input.writer.write(chunk),
          abortSignal: input.abortSignal,
        });
        finishRun(input, run);
      } catch (error) {
        setSpanOutcome(AfOutcome.Error, "agent_run_threw");
        log.error("workflow_builder.chat_failed", {
          reason: "agent_run_threw",
          organizationId: caller.organizationId,
          userId: caller.userId,
          error,
        });
        scheduleLogFlush();
        input.writer.write({ type: "error", errorText: STREAM_ERROR_MESSAGE });
      } finally {
        input.release();
      }
    }
  );
}

function finishRun(
  input: CliRunInput,
  run: WorkflowBuilderChatRunResult
): void {
  const { caller, writer } = input;
  if (run.end === RunEnd.Aborted) {
    log.info("workflow_builder.chat_aborted", {
      organizationId: caller.organizationId,
      userId: caller.userId,
    });
    return;
  }
  const failure = classifyFailure(run);
  if (failure !== null) {
    setSpanOutcome(AfOutcome.Error, failure);
    log.error("workflow_builder.chat_failed", {
      reason: failure,
      organizationId: caller.organizationId,
      userId: caller.userId,
      exitCode: run.exitCode,
      resultSubtype: run.resultSubtype,
      error: null,
    });
    scheduleLogFlush();
    writer.write({
      type: "error",
      errorText:
        failure === CliFailureReason.Timeout
          ? STREAM_TIMEOUT_MESSAGE
          : STREAM_ERROR_MESSAGE,
    });
    return;
  }
  if (run.outcome === AgentRunOutcome.MaxTurns) {
    log.warn("workflow_builder.chat_max_turns", {
      reason: "max_turns",
      organizationId: caller.organizationId,
      userId: caller.userId,
      error: null,
    });
  } else {
    log.debug("workflow_builder.chat_completed", {
      proposal: run.proposal,
      permissionDenials: run.permissionDenials,
    });
  }
  writer.write({ type: "finish" });
}

function classifyFailure(
  run: WorkflowBuilderChatRunResult
): CliFailureReason | null {
  if (run.end === RunEnd.Timeout) {
    return CliFailureReason.Timeout;
  }
  if (run.end === RunEnd.SpawnFailed) {
    return CliFailureReason.SpawnFailed;
  }
  if (run.outcome === AgentRunOutcome.MaxTurns) {
    return null;
  }
  if (run.outcome === AgentRunOutcome.CliError) {
    return CliFailureReason.ResultError;
  }
  if (run.exitCode !== null && run.exitCode !== 0) {
    return CliFailureReason.ExitNonzero;
  }
  if (run.outcome === AgentRunOutcome.NoResult) {
    return CliFailureReason.NoResult;
  }
  return null;
}
