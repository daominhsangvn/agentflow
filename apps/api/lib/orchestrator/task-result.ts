import { z } from "zod";

/**
 * What a finished orchestrator task left (`orchestrator_tasks.result`): its
 * agent's answer file, the questions it asked, or why it failed.
 */

export type TaskResult = {
  reply: string | null;
  questions: Array<{ id: string; question: string; options?: string[] }>;
  error: string | null;
  /** Why a queued task has not started (a busy runner). */
  waiting?: string | null;
  /** Why task_cancel stopped the task. */
  cancelled?: string | null;
  /** The status the task had when it was cancelled. */
  cancelledFrom?: string | null;
  /** Files the task's command left for the ticket (its `attach` globs). */
  files?: TaskFile[];
  /** Matching files beyond the collection limit. */
  filesOmitted?: number;
  /** Text files of earlier tasks, handed to this task until it launches. */
  inputs?: TaskInputFile[];
  /** The ref of the message (comment) this task's answer replies to (task_run replyTo). */
  replyTo?: string | null;
  /** Confluence pages read when task_run ran, written to `inputs/` at launch. */
  pageInputs?: TaskPageInput[];
};

/**
 * A file a task left: `name` is its path relative to the task's work dir
 * (`PRD-LD-5.md`, `evidence-LD-5/a.png`). `storageKey` is null when it was
 * not stored; `skipped` then says why.
 */
export type TaskFile = {
  name: string;
  size: number;
  storageKey: string | null;
  skipped: string | null;
};

/** A stored file of an earlier task, to be written to the next task's `inputs/`. */
export type TaskInputFile = {
  taskId: string;
  name: string;
  storageKey: string;
  size: number;
};

/** A Confluence page's Markdown, read when task_run ran and handed to the task as an input file. */
export type TaskPageInput = {
  pageId: string;
  title: string;
  url: string;
  version: number;
  name: string;
  content: string;
  size: number;
};

const taskFileSchema = z.object({
  name: z.string(),
  size: z.number(),
  storageKey: z.string().nullable(),
  skipped: z.string().nullable(),
});

const taskInputFileSchema = z.object({
  taskId: z.string(),
  name: z.string(),
  storageKey: z.string(),
  size: z.number(),
});

const taskPageInputSchema = z.object({
  pageId: z.string(),
  title: z.string(),
  url: z.string(),
  version: z.number(),
  name: z.string(),
  content: z.string(),
  size: z.number(),
});

const taskResultSchema = z.object({
  reply: z.string().nullable(),
  questions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        options: z.array(z.string()).optional(),
      })
    )
    .default([]),
  error: z.string().nullable(),
  waiting: z.string().nullish(),
  cancelled: z.string().nullish(),
  cancelledFrom: z.string().nullish(),
  files: z.array(taskFileSchema).optional(),
  filesOmitted: z.number().optional(),
  inputs: z.array(taskInputFileSchema).optional(),
  replyTo: z.string().nullish(),
  pageInputs: z.array(taskPageInputSchema).optional(),
});

export function readTaskResult(value: unknown): TaskResult | null {
  const parsed = taskResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const KEPT_FIELDS = [
  "inputs",
  "waiting",
  "cancelled",
  "cancelledFrom",
  "replyTo",
  "pageInputs",
] as const;

/**
 * The result to store: `next` over the fields an earlier write left (inputs,
 * waiting, cancel notes), so a later write does not erase them.
 */
export function mergeTaskResult(
  previous: unknown,
  next: TaskResult
): TaskResult {
  const stored = readTaskResult(previous);
  if (!stored) {
    return next;
  }
  const kept: Partial<TaskResult> = {};
  for (const field of KEPT_FIELDS) {
    if (stored[field] !== undefined) {
      Object.assign(kept, { [field]: stored[field] });
    }
  }
  return { ...kept, ...next };
}
