import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { log } from "@repo/observability/log";
import { z } from "zod";

export const KnowledgeUnavailableReason = {
  Missing: "knowledge_bundle_missing",
  Invalid: "knowledge_bundle_invalid",
} as const;
export type KnowledgeUnavailableReason =
  (typeof KnowledgeUnavailableReason)[keyof typeof KnowledgeUnavailableReason];

const guideSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  source: z.string(),
  text: z.string(),
});

const bundleSchema = z.object({
  version: z.number(),
  guides: z.array(guideSchema),
});

export type KnowledgeGuide = z.infer<typeof guideSchema>;

export type KnowledgeLoadResult =
  | { ok: true; guides: KnowledgeGuide[] }
  | { ok: false; reason: KnowledgeUnavailableReason };

export type KnowledgeLoader = {
  load(): Promise<KnowledgeLoadResult>;
};

export function createKnowledgeLoader(
  file = path.join(
    process.cwd(),
    "generated",
    "workflow-builder-knowledge.json"
  )
): KnowledgeLoader {
  let cache: { mtimeMs: number; result: KnowledgeLoadResult } | null = null;
  let lastWarnedReason: KnowledgeUnavailableReason | null = null;

  function warnOnChange(result: KnowledgeLoadResult, errorName: string): void {
    if (result.ok) {
      lastWarnedReason = null;
      return;
    }
    if (lastWarnedReason === result.reason) {
      return;
    }
    lastWarnedReason = result.reason;
    log.warn("workflow_builder.knowledge_unavailable", {
      reason: result.reason,
      error: { name: errorName },
    });
  }

  async function load(): Promise<KnowledgeLoadResult> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(file)).mtimeMs;
    } catch (error) {
      cache = null;
      const result = {
        ok: false,
        reason: KnowledgeUnavailableReason.Missing,
      } as const;
      warnOnChange(result, errorName(error));
      return result;
    }
    if (cache?.mtimeMs === mtimeMs) {
      return cache.result;
    }
    const { result, name } = await readBundle(file);
    cache = { mtimeMs, result };
    warnOnChange(result, name);
    return result;
  }

  return { load };
}

async function readBundle(
  file: string
): Promise<{ result: KnowledgeLoadResult; name: string }> {
  try {
    const parsed = bundleSchema.safeParse(
      JSON.parse(await readFile(file, "utf8"))
    );
    if (parsed.success) {
      return {
        result: { ok: true, guides: parsed.data.guides },
        name: "none",
      };
    }
    return {
      result: { ok: false, reason: KnowledgeUnavailableReason.Invalid },
      name: "ZodError",
    };
  } catch (error) {
    return {
      result: { ok: false, reason: KnowledgeUnavailableReason.Invalid },
      name: errorName(error),
    };
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
