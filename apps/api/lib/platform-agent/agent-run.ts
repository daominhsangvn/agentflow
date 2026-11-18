import { buildClaudeChildEnv, type EnvLike } from "./child-env";
import type { ClaudeCodeCommand } from "./claude-code";
import { buildClaudeArgs, type CliRunResult, runClaudeCli } from "./cli-runner";
import type { ClaudeCodeTool } from "./stream-json";
import { type AgentWorkDirFile, createAgentWorkDir } from "./work-dir";

/**
 * One platform agent call: temp work dir with the given files, allowlisted child env, one `claude -p`
 * run, work dir removed afterwards (also on timeout and abort). Callers own logging and outcomes.
 */
export async function runPlatformAgent(input: {
  command: ClaudeCodeCommand;
  settingsEnv: Record<string, string>;
  files: readonly AgentWorkDirFile[];
  systemPrompt: string;
  prompt: string;
  tools: readonly ClaudeCodeTool[];
  maxTurns: number;
  timeoutMs: number;
  onLine: (line: string, context: { workDir: string }) => void;
  abortSignal?: AbortSignal;
  baseEnv?: EnvLike;
  tmpRoot?: string;
  platform?: NodeJS.Platform;
}): Promise<CliRunResult> {
  const workDir = await createAgentWorkDir({
    files: input.files,
    tmpRoot: input.tmpRoot,
  });
  try {
    const env = buildClaudeChildEnv({
      baseEnv: input.baseEnv ?? process.env,
      settingsEnv: input.settingsEnv,
      configDir: workDir.configDir,
      platform: input.platform,
    });
    return await runClaudeCli({
      command: input.command,
      args: buildClaudeArgs({
        systemPrompt: input.systemPrompt,
        maxTurns: input.maxTurns,
        tools: input.tools,
      }),
      cwd: workDir.workDir,
      env,
      stdin: input.prompt,
      onLine: (line) => input.onLine(line, { workDir: workDir.workDir }),
      timeoutMs: input.timeoutMs,
      abortSignal: input.abortSignal,
      platform: input.platform,
    });
  } finally {
    await workDir.dispose();
  }
}
