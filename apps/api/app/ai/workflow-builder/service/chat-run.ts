import { randomUUID } from "node:crypto";
import type { UIMessage } from "@repo/ai";
import { runPlatformAgent } from "@/lib/platform-agent/agent-run";
import type { EnvLike } from "@/lib/platform-agent/child-env";
import type { ClaudeCodeCommand } from "@/lib/platform-agent/claude-code";
import { RunEnd } from "@/lib/platform-agent/cli-runner";
import {
  type AgentRunOutcome,
  ClaudeCodeTool,
} from "@/lib/platform-agent/stream-json";
import type { KnowledgeGuide } from "./knowledge";
import {
  renderConversationPrompt,
  WORKFLOW_BUILDER_SYSTEM_PROMPT,
} from "./prompt";
import { createStreamJsonMapper, type UiChunkSink } from "./stream-mapper";
import { buildWorkflowBuilderWorkDirFiles } from "./work-dir-files";

export const WORKFLOW_BUILDER_MAX_TURNS = 12;
export const WORKFLOW_BUILDER_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
export const WORKFLOW_BUILDER_TOOLS = [
  ClaudeCodeTool.Read,
  ClaudeCodeTool.Grep,
  ClaudeCodeTool.Glob,
] as const;

export type WorkflowBuilderChatRunResult = {
  end: RunEnd;
  /** `null` when the run was aborted (nothing more is written). */
  outcome: AgentRunOutcome | null;
  exitCode: number | null;
  proposal: boolean;
  permissionDenials: number;
  ignoredLines: number;
  resultSubtype?: string;
};

/**
 * Runs one workflow builder chat turn on the platform agent and streams UI message chunks to `write`.
 * Writes `start`/`start-step` ... `finish-step`; the caller writes `finish`/`error` and owns logging.
 */
export async function runWorkflowBuilderChat(input: {
  command: ClaudeCodeCommand;
  settingsEnv: Record<string, string>;
  guides: KnowledgeGuide[];
  catalog: unknown;
  messages: UIMessage[];
  editorYaml: string;
  write: UiChunkSink;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  baseEnv?: EnvLike;
  generateId?: () => string;
  tmpRoot?: string;
}): Promise<WorkflowBuilderChatRunResult> {
  const mapper = createStreamJsonMapper({
    write: input.write,
    generateId: input.generateId ?? (() => `wb-${randomUUID()}`),
  });
  mapper.begin();
  let run: Awaited<ReturnType<typeof runPlatformAgent>>;
  try {
    run = await runPlatformAgent({
      command: input.command,
      settingsEnv: input.settingsEnv,
      files: buildWorkflowBuilderWorkDirFiles({
        guides: input.guides,
        catalog: input.catalog,
        editorYaml: input.editorYaml,
      }),
      systemPrompt: WORKFLOW_BUILDER_SYSTEM_PROMPT,
      prompt: renderConversationPrompt({
        messages: input.messages,
        editorYaml: input.editorYaml,
      }),
      tools: WORKFLOW_BUILDER_TOOLS,
      maxTurns: WORKFLOW_BUILDER_MAX_TURNS,
      timeoutMs: input.timeoutMs ?? WORKFLOW_BUILDER_REQUEST_TIMEOUT_MS,
      onLine: (line, { workDir }) => mapper.line(line, workDir),
      abortSignal: input.abortSignal,
      baseEnv: input.baseEnv,
      tmpRoot: input.tmpRoot,
    });
  } catch (error) {
    mapper.abort();
    throw error;
  }
  if (run.end === RunEnd.Aborted) {
    mapper.abort();
    return {
      end: run.end,
      outcome: null,
      exitCode: run.exitCode,
      proposal: false,
      permissionDenials: 0,
      ignoredLines: 0,
    };
  }
  return { end: run.end, exitCode: run.exitCode, ...mapper.end() };
}
