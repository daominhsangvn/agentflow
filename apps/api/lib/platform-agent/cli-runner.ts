import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { ClaudeCodeCommand } from "./claude-code";
import { killProcessTree } from "./process-tree";
import type { ClaudeCodeTool } from "./stream-json";

const MAX_LINE_BYTES = 4 * 1024 * 1024;
const KILL_GRACE_MS = 10_000;

export const RunEnd = {
  Exited: "exited",
  Timeout: "timeout",
  Aborted: "aborted",
  SpawnFailed: "spawn_failed",
} as const;
export type RunEnd = (typeof RunEnd)[keyof typeof RunEnd];

export type CliRunResult = {
  end: RunEnd;
  exitCode: number | null;
  droppedLines: number;
};

/** argv for a headless, tool-restricted run. The prompt is NOT in argv (it goes to stdin). */
export function buildClaudeArgs(input: {
  systemPrompt: string;
  maxTurns: number;
  tools: readonly ClaudeCodeTool[];
}): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--input-format",
    "text",
    "--tools",
    input.tools.join(","),
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--max-turns",
    String(input.maxTurns),
    "--system-prompt",
    input.systemPrompt,
  ];
}

/**
 * Spawns the CLI (argv array, no shell), feeds `stdin`, forwards stdout lines, and ends the run on
 * exit, timeout or abort. Timeout and abort kill the whole process tree.
 */
export function runClaudeCli(input: {
  command: ClaudeCodeCommand;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  onLine: (line: string) => void;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  platform?: NodeJS.Platform;
}): Promise<CliRunResult> {
  if (input.abortSignal?.aborted) {
    return Promise.resolve({
      end: RunEnd.Aborted,
      exitCode: null,
      droppedLines: 0,
    });
  }
  return new Promise<CliRunResult>((resolve) => {
    const platform = input.platform ?? process.platform;
    const state = createRunState(input.onLine, resolve);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        input.command.file,
        [...input.command.prefixArgs, ...input.args],
        {
          cwd: input.cwd,
          // The project's ProcessEnv type requires NODE_ENV; a child env must not carry it.
          env: input.env as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          shell: false,
          detached: platform !== "win32",
        }
      );
    } catch {
      // observability: reported to the caller as RunEnd.SpawnFailed
      resolve({ end: RunEnd.SpawnFailed, exitCode: null, droppedLines: 0 });
      return;
    }

    const kill = (reason: RunEnd) => {
      if (state.endReason !== null) {
        return;
      }
      state.endReason = reason;
      const killed =
        child.pid === undefined
          ? Promise.resolve()
          : killProcessTree(child.pid, platform);
      state.killed = killed;
      // The grace period starts once the tree kill call has returned.
      killed.then(() => {
        if (!state.isSettled()) {
          state.graceTimer = setTimeout(
            () => state.finish(reason, null),
            KILL_GRACE_MS
          );
        }
      });
    };
    const onAbort = () => kill(RunEnd.Aborted);
    const timer = setTimeout(() => kill(RunEnd.Timeout), input.timeoutMs);
    input.abortSignal?.addEventListener("abort", onAbort, { once: true });
    state.cleanup = () => {
      clearTimeout(timer);
      if (state.graceTimer !== null) {
        clearTimeout(state.graceTimer);
      }
      input.abortSignal?.removeEventListener("abort", onAbort);
    };

    child.on("error", () => state.finish(RunEnd.SpawnFailed, null));
    child.on("close", (code) => {
      state.flush();
      // Resolve only after the tree kill call has finished, so the caller removes the work dir
      // after the tree is gone.
      state.killed.then(() =>
        state.finish(state.endReason ?? RunEnd.Exited, code)
      );
    });
    child.stdin?.on("error", () => {
      // observability: EPIPE when the CLI exits before reading stdin; the exit is reported anyway
    });
    child.stdin?.end(input.stdin);
    child.stderr?.resume();
    const decoder = new StringDecoder("utf8");
    child.stdout?.on("data", (chunk: Buffer) =>
      state.push(decoder.write(chunk))
    );
  });
}

type RunState = {
  endReason: RunEnd | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  killed: Promise<void>;
  isSettled(): boolean;
  cleanup: () => void;
  push(text: string): void;
  flush(): void;
  finish(end: RunEnd, exitCode: number | null): void;
};

function createRunState(
  onLine: (line: string) => void,
  resolve: (result: CliRunResult) => void
): RunState {
  let buffer = "";
  let discarding = false;
  let droppedLines = 0;
  let settled = false;

  const deliver = (raw: string) => {
    if (state.endReason !== null) {
      return;
    }
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") {
      return;
    }
    if (line.length > MAX_LINE_BYTES) {
      droppedLines += 1;
      return;
    }
    try {
      onLine(line);
    } catch {
      // observability: a consumer error must not break the run; the caller owns its outcome
    }
  };

  const state: RunState = {
    endReason: null,
    graceTimer: null,
    killed: Promise.resolve(),
    isSettled: () => settled,
    cleanup: () => undefined,
    push(text) {
      buffer += text;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (discarding) {
          discarding = false;
        } else {
          deliver(raw);
        }
        index = buffer.indexOf("\n");
      }
      if (discarding) {
        buffer = "";
      } else if (buffer.length > MAX_LINE_BYTES) {
        buffer = "";
        discarding = true;
        droppedLines += 1;
      }
    },
    flush() {
      if (!discarding && buffer !== "") {
        deliver(buffer);
      }
      buffer = "";
    },
    finish(end, exitCode) {
      if (settled) {
        return;
      }
      settled = true;
      state.cleanup();
      resolve({ end, exitCode, droppedLines });
    },
  };
  return state;
}
