import { readFileSync } from "node:fs";
import { LoopCommand } from "@agentflow-ai/loops-api/commands";
import type { LoopStepConfig } from "@agentflow-ai/loops-api/loop-step";
import { z } from "zod";
import { resolveClaudeOutputPath } from "../../main/cost/token-usage.js";

/**
 * A workflow step that continues an earlier run's agent session asks for
 * `step.reportResumeMiss`. When Claude Code then cannot find the session in
 * the loop's folder, the loop fails with RESUME_SESSION_NOT_FOUND so the API
 * can fall back to a copy of the session or a fresh one.
 *
 * The check is gated on that flag: every other loop (an orchestrator case
 * task, an ordinary step) keeps the error codes it has today.
 */

/** What Claude Code prints when `--resume` names a session it does not have. */
export const RESUME_SESSION_MISSING_RE =
  /no conversation found|session (?:id )?not found|failed to load session/i;

export type ResumeMissInput = {
  command: string;
  step: LoopStepConfig | null | undefined;
  parentSessionId: string | null | undefined;
  texts: readonly (string | undefined)[];
  producedAssistantMessage: boolean;
};

/**
 * True for a failed STEP loop that asked to report a resume miss, was
 * launched with `--resume`, never produced an assistant message, and whose
 * error output matches the missing-session pattern.
 */
export function isStepResumeSessionMiss(input: ResumeMissInput): boolean {
  if (
    input.command !== LoopCommand.Step ||
    input.step?.reportResumeMiss !== true ||
    !input.parentSessionId ||
    input.producedAssistantMessage
  ) {
    return false;
  }
  return input.texts.some(
    (text) => text !== undefined && RESUME_SESSION_MISSING_RE.test(text)
  );
}

/**
 * Reads the loop's Claude output once: whether any assistant record exists
 * and the text of every error result record.
 */
export function scanClaudeOutputForResumeMiss(claudeWorkDir: string): {
  producedAssistantMessage: boolean;
  errorResultTexts: string[];
} {
  const scan = {
    producedAssistantMessage: false,
    errorResultTexts: [] as string[],
  };
  const outputFile = resolveClaudeOutputPath(claudeWorkDir);
  if (outputFile === null) {
    return scan;
  }
  let content: string;
  try {
    content = readFileSync(outputFile, "utf-8");
  } catch {
    // observability: probe — an unreadable output file means no evidence
    return scan;
  }
  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    collectScanRecord(line, scan);
  }
  return scan;
}

function collectScanRecord(
  line: string,
  scan: { producedAssistantMessage: boolean; errorResultTexts: string[] }
): void {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    // observability: parse fallback — a malformed jsonl line is skipped
    return;
  }
  const parsed = outputRecordSchema.safeParse(entry);
  if (!parsed.success) {
    return;
  }
  const record = parsed.data;
  if (record.type === "assistant") {
    scan.producedAssistantMessage = true;
  } else if (record.type === "result" && record.is_error === true) {
    scan.errorResultTexts.push(record.result);
  }
}

/** The records of the Claude output the scan reads: an assistant record, or an error result with its text. */
const outputRecordSchema = z.union([
  z.object({ type: z.literal("assistant") }),
  z.object({
    type: z.literal("result"),
    is_error: z.boolean(),
    result: z.string(),
  }),
]);

/**
 * The completion handler's check: scans the loop's Claude output only for a
 * STEP loop that asked for it, so other loops pay nothing and keep their codes.
 */
export function isResumeSessionMissing(
  body: {
    command: string;
    step?: LoopStepConfig | null;
    parentSessionId?: string | null;
  },
  diagnostics: { stderrTail?: string; logTail?: string },
  claudeWorkDir: string
): boolean {
  if (body.step?.reportResumeMiss !== true || !body.parentSessionId) {
    return false;
  }
  const scan = scanClaudeOutputForResumeMiss(claudeWorkDir);
  return isStepResumeSessionMiss({
    command: body.command,
    step: body.step,
    parentSessionId: body.parentSessionId,
    texts: [
      diagnostics.stderrTail,
      diagnostics.logTail,
      ...scan.errorResultTexts,
    ],
    producedAssistantMessage: scan.producedAssistantMessage,
  });
}
