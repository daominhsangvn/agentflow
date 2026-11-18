import type { UIMessageChunk } from "@repo/ai";
import { claudeCodeVersionSchema } from "@repo/api/src/types/compute-target-model-provider";
import { WorkflowBuilderDisabledReason } from "@repo/api/src/types/workflow-builder";
import { runWorkflowBuilderChat } from "../app/ai/workflow-builder/service/chat-run";
import { createKnowledgeLoader } from "../app/ai/workflow-builder/service/knowledge";
import { createClaudeCodeResolver } from "../lib/platform-agent/claude-code";
import { RunEnd } from "../lib/platform-agent/cli-runner";
import { createPlatformAgentSettingsLoader } from "../lib/platform-agent/settings";
import { AgentRunOutcome } from "../lib/platform-agent/stream-json";

const SETTINGS_FLAG = "--settings";
const CLAUDE_PATH_FLAG = "--claude-path";
const VERSION_FLAG = "--version";
const INVALID_VERSION = "invalid version";
const MAX_TEXT_CHARS = 300;
const SMOKE_PROMPT =
  "Read README.md and answer in one sentence with the number of guides it lists. Do not propose a workflow.";

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    // Only the error name: errors can carry upstream URLs and headers.
    console.error(error instanceof Error ? error.name : "UnknownError");
    process.exit(1);
  });

async function main(): Promise<number> {
  const settingsFile =
    readFlag(SETTINGS_FLAG) ??
    nonEmpty(process.env.PLATFORM_AGENT_SETTINGS_FILE);
  if (!settingsFile) {
    console.error(WorkflowBuilderDisabledReason.NotConfigured);
    return 1;
  }
  const requested =
    readFlag(VERSION_FLAG) ??
    nonEmpty(process.env.PLATFORM_AGENT_CLAUDE_CODE_VERSION);
  if (
    requested !== undefined &&
    !claudeCodeVersionSchema.safeParse(requested).success
  ) {
    console.error(INVALID_VERSION);
    return 1;
  }
  const explicitPath =
    readFlag(CLAUDE_PATH_FLAG) ??
    nonEmpty(process.env.PLATFORM_AGENT_CLAUDE_CODE_PATH);

  const settingsStep = await timed(() =>
    createPlatformAgentSettingsLoader().load(settingsFile)
  );
  if (!settingsStep.value.ok) {
    console.error(settingsStep.value.reason);
    return 1;
  }
  const { settings } = settingsStep.value;
  console.log(
    `settings loaded (${settingsStep.ms}ms): ${JSON.stringify(settings.summary)}`
  );

  const knowledgeStep = await timed(() => createKnowledgeLoader().load());
  if (!knowledgeStep.value.ok) {
    console.error(knowledgeStep.value.reason);
    return 1;
  }
  const { guides } = knowledgeStep.value;
  console.log(
    `knowledge bundle (${knowledgeStep.ms}ms): guides=${guides.length}`
  );

  const claudeStep = await timed(() =>
    createClaudeCodeResolver().resolve({ requested, explicitPath })
  );
  if (!claudeStep.value.ok) {
    console.error(claudeStep.value.reason);
    return 1;
  }
  const claude = claudeStep.value;
  console.log(
    `claude code (${claudeStep.ms}ms): version=${claude.version} source=${claude.source} requested=${requested ?? "none"}`
  );

  const chunks: UIMessageChunk[] = [];
  const runStep = await timed(() =>
    runWorkflowBuilderChat({
      command: claude.command,
      settingsEnv: settings.env,
      guides,
      catalog: { note: "smoke run: no organization data" },
      messages: [
        {
          id: "smoke-1",
          role: "user",
          parts: [{ type: "text", text: SMOKE_PROMPT }],
        },
      ],
      editorYaml: "",
      write: (chunk) => {
        chunks.push(chunk);
      },
    })
  );
  const run = runStep.value;
  const toolActivity = chunks.filter(
    (chunk) => chunk.type === "tool-input-available" && chunk.providerExecuted
  ).length;
  const text = chunks
    .map((chunk) => (chunk.type === "text-delta" ? chunk.delta : ""))
    .join("");
  console.log(
    `run (${runStep.ms}ms): end=${run.end} outcome=${run.outcome} exitCode=${run.exitCode} tools=${toolActivity} proposal=${run.proposal ? "yes" : "no"}`
  );
  console.log(`text: ${text.slice(0, MAX_TEXT_CHARS)}`);
  return run.end === RunEnd.Exited && run.outcome === AgentRunOutcome.Success
    ? 0
    : 1;
}

function readFlag(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : nonEmpty(process.argv[index + 1]);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

async function timed<T>(
  work: () => Promise<T>
): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await work();
  return { value, ms: Date.now() - started };
}
