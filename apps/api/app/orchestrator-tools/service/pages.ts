import { LOOP_STEP_FILE_BYTES_MAX } from "@agentflow-ai/loops-api/loop-step";
import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import { OrchestratorDocumentKind } from "@repo/api/src/types/orchestrator";
import { OrchestratorPageAccess } from "@repo/api/src/types/orchestrator-grants";
import { Result } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { z } from "zod";
import {
  cleanFileName,
  uploadContentType,
} from "@/app/integration-tools/service/attachments";
import { createProviderContext } from "@/lib/integrations/connection-service";
import { loadProjectConnectionRuntime } from "@/lib/integrations/project-connections";
import { BODY_MAX } from "@/lib/integrations/providers/confluence/bodies";
import type { ConfluenceContext } from "@/lib/integrations/providers/confluence/client";
import {
  publishMarkdownPage,
  readPageMarkdown,
  toConfluenceContext,
} from "@/lib/integrations/providers/confluence/publish";
import { jsonValueSchema } from "@/lib/json-schema";
import { getLoopAttachment } from "@/lib/loops/loop-state";
import {
  listCaseDocuments,
  recordDocument,
} from "@/lib/orchestrator/case-documents";
import {
  findCaseTaskFiles,
  taskFileRefSchema,
} from "@/lib/orchestrator/task-files";
import {
  readTaskResult,
  type TaskPageInput,
} from "@/lib/orchestrator/task-result";
import { scrubProviderError } from "@/lib/workflows/engine/errors";
import { refused, type ToolOutcome } from "./turn";

/**
 * The orchestrator's Confluence tools: page_publish (a task's Markdown file
 * and its attachments become a page), page_get (a page as Markdown) and the
 * page files of task_run. Scope: the Confluence project connections of the
 * turn's project; the provider's space guard decides which pages are usable.
 */

const LOG_PREFIX = "[orchestrator-tools]";
const TITLE_MAX = 255;
const REFERENCE_MAX = 2048;
const PAGE_ATTACHMENTS_MAX = 10;
const PAGE_FILES_BYTES_MAX = 20 * 1024 * 1024;

export const pagePublishInputSchema = z.object({
  file: taskFileRefSchema,
  title: z.string().trim().min(1).max(TITLE_MAX),
  kind: z
    .enum(OrchestratorDocumentKind)
    .default(OrchestratorDocumentKind.Other),
  page: z.string().trim().min(1).max(REFERENCE_MAX).optional(),
  parent: z.string().trim().min(1).max(REFERENCE_MAX).optional(),
  space: z.string().trim().min(1).max(255).optional(),
  attachments: z.array(taskFileRefSchema).max(PAGE_ATTACHMENTS_MAX).default([]),
  overwrite: z.boolean().default(false),
  connection: z.string().trim().min(1).max(255).optional(),
});
export type PagePublishInput = z.infer<typeof pagePublishInputSchema>;

export const pageGetInputSchema = z.object({
  page: z.string().trim().min(1).max(REFERENCE_MAX),
  connection: z.string().trim().min(1).max(255).optional(),
});
export type PageGetInput = z.infer<typeof pageGetInputSchema>;

/** A page handed to a task as an input file: `task_run files [{page, name}]`. */
export const pageFileRefSchema = z.object({
  page: z.string().trim().min(1).max(REFERENCE_MAX),
  name: z.string().trim().min(1).max(200),
});
export type PageFileRef = z.infer<typeof pageFileRefSchema>;

/** The part of the turn the page tools need. */
export type PageToolContext = {
  organizationId: string;
  projectId: string;
  caseId: string;
  conversationId: string;
  turnId: string;
  /** The Confluence connection keys granted for reading and publishing. */
  pageKeys: { read: readonly string[]; publish: readonly string[] };
};

type LoadedConfluence = {
  ctx: ConfluenceContext;
  secrets: Record<string, unknown>;
};

export async function publishPage(
  context: PageToolContext,
  input: PagePublishInput
): Promise<ToolOutcome> {
  const loaded = await loadConfluence(
    context,
    input.connection,
    OrchestratorPageAccess.Publish
  );
  if (!loaded.ok) {
    return refused(loaded.error);
  }
  const { ctx, secrets } = loaded.value;
  const files = await readFiles(context.caseId, [
    input.file,
    ...input.attachments,
  ]);
  if (!files.ok) {
    return refused(files.error);
  }
  const [main, ...attachments] = files.value;
  if (!main) {
    return refused("The file could not be read.");
  }
  let markdown: string;
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(main.bytes);
  } catch {
    return refused(
      `"${main.name}" is not a text file: publish a Markdown file.`
    );
  }
  const documents = await listCaseDocuments(
    context.organizationId,
    context.caseId
  );
  const recordedVersions = await knownVersions(
    context.caseId,
    input.file.taskId,
    documents
  );
  const published = await safely(secrets, () =>
    publishMarkdownPage(ctx, {
      title: input.title,
      markdown,
      page: input.page ?? null,
      parent: input.parent ?? null,
      space: input.space ?? null,
      files: attachments.map((file) => ({
        name: file.name,
        contentType: file.contentType,
        bytes: file.bytes,
      })),
      overwrite: input.overwrite,
      recordedVersions,
    })
  );
  if (!published.ok) {
    return fromFailure(published.error, secrets);
  }
  const page = published.value;
  await recordDocument({
    organizationId: context.organizationId,
    conversationId: context.conversationId,
    turnId: context.turnId,
    document: {
      pageId: page.pageId,
      title: page.title,
      url: page.url,
      version: page.version,
      kind: input.kind,
      space: page.space,
      attachments: page.attachments,
    },
  });
  return output({
    pageId: page.pageId,
    title: page.title,
    url: page.url,
    version: page.version,
    created: page.created,
    attachments: page.attachments,
    next: "Comment the link on the ticket (no file attachments).",
  });
}

export async function getPage(
  context: PageToolContext,
  input: PageGetInput
): Promise<ToolOutcome> {
  const loaded = await loadConfluence(
    context,
    input.connection,
    OrchestratorPageAccess.Read
  );
  if (!loaded.ok) {
    return refused(loaded.error);
  }
  const { ctx, secrets } = loaded.value;
  const read = await safely(secrets, () =>
    readPageMarkdown(ctx, input.page, BODY_MAX)
  );
  if (!read.ok) {
    return fromFailure(read.error, secrets);
  }
  const page = read.value;
  return output({
    pageId: page.pageId,
    title: page.title,
    url: page.url,
    version: page.version,
    space: page.space,
    parentId: page.parentId,
    lastEditedBy: page.lastEditedBy,
    truncated: page.truncated,
    markdown: page.markdown,
  });
}

/** Reads the pages for task_run; each becomes an input file of the task. */
export async function resolvePageInputs(
  context: PageToolContext,
  refs: PageFileRef[]
): Promise<Result<TaskPageInput[], string>> {
  if (refs.length === 0) {
    return Result.ok([]);
  }
  const loaded = await loadConfluence(
    context,
    undefined,
    OrchestratorPageAccess.Read
  );
  if (!loaded.ok) {
    return loaded;
  }
  const { ctx, secrets } = loaded.value;
  const inputs: TaskPageInput[] = [];
  for (const ref of refs) {
    const read = await safely(secrets, () =>
      readPageMarkdown(ctx, ref.page, LOOP_STEP_FILE_BYTES_MAX)
    );
    if (!read.ok) {
      return Result.err(scrubProviderError(read.error.error, secrets));
    }
    const page = read.value;
    if (page.truncated) {
      return Result.err(`"${page.title}" is too large to hand to a task.`);
    }
    inputs.push({
      pageId: page.pageId,
      title: page.title,
      url: page.url,
      version: page.version,
      name: ref.name,
      content: page.markdown,
      size: new TextEncoder().encode(page.markdown).length,
    });
  }
  return Result.ok(inputs);
}

type Failure = { error: string; retryable: boolean };

type LoadedFile = { name: string; contentType: string; bytes: Uint8Array };

async function loadConfluence(
  context: Pick<PageToolContext, "organizationId" | "projectId" | "pageKeys">,
  key: string | undefined,
  access: OrchestratorPageAccess
): Promise<Result<LoadedConfluence, string>> {
  const connections = await withDb((db) =>
    db.projectConnection.findMany({
      where: {
        organizationId: context.organizationId,
        projectId: context.projectId,
        connection: { provider: IntegrationProviderKey.Confluence },
      },
      select: { id: true, key: true },
      orderBy: { createdAt: "asc" },
    })
  );
  if (connections.length === 0) {
    return Result.err(
      "This project has no Confluence connection: add one with its spaces (Project → Integrations)."
    );
  }
  const granted = new Set(
    access === OrchestratorPageAccess.Publish
      ? context.pageKeys.publish
      : context.pageKeys.read
  );
  const usable = connections.filter((connection) =>
    granted.has(connection.key)
  );
  if (usable.length === 0) {
    return Result.err(
      `No Confluence connection is granted for ${access} (agent.orchestrator.connections).`
    );
  }
  const keys = usable.map((connection) => connection.key).join(", ");
  const chosen = chooseConnection(usable, key);
  if (!chosen) {
    return Result.err(`connection: one of ${keys}.`);
  }
  const runtime = await loadProjectConnectionRuntime(
    context.organizationId,
    chosen.id
  );
  if (!runtime) {
    return Result.err(
      `The Confluence connection ${chosen.key} could not be loaded: check it under Project → Integrations.`
    );
  }
  const ctx = toConfluenceContext(
    createProviderContext(runtime.connection.runtime, LOG_PREFIX)
  );
  if (!ctx) {
    return Result.err(
      `The Confluence connection ${chosen.key} is not set up correctly: check it under Project → Integrations.`
    );
  }
  return Result.ok({ ctx, secrets: runtime.connection.runtime.secrets });
}

function chooseConnection(
  connections: { id: string; key: string }[],
  key: string | undefined
): { id: string; key: string } | undefined {
  if (key) {
    return connections.find((connection) => connection.key === key);
  }
  return connections.length === 1 ? connections[0] : undefined;
}

async function readFiles(
  caseId: string,
  refs: z.infer<typeof taskFileRefSchema>[]
): Promise<Result<LoadedFile[], string>> {
  const found = await findCaseTaskFiles(caseId, refs);
  if (!found.ok) {
    return found;
  }
  const total = found.value.reduce((sum, file) => sum + file.size, 0);
  if (total > PAGE_FILES_BYTES_MAX) {
    return Result.err(
      `The files are too large to publish in one call (${Math.ceil(total / 1024 / 1024)} MB, at most ${PAGE_FILES_BYTES_MAX / 1024 / 1024} MB): publish fewer attachments.`
    );
  }
  const files: LoadedFile[] = [];
  const names = new Set<string>();
  for (const file of found.value) {
    let bytes: Uint8Array;
    try {
      bytes = await getLoopAttachment(file.storageKey);
    } catch {
      return Result.err(`File "${file.name}" could not be read from storage.`);
    }
    const name = cleanFileName(baseName(file.name)) ?? "file";
    if (names.has(name)) {
      return Result.err(
        `Two files are named "${name}": rename one in its task or leave one out.`
      );
    }
    names.add(name);
    files.push({ name, contentType: uploadContentType(null, name), bytes });
  }
  return Result.ok(files);
}

/**
 * The page versions known to the case: the ones it published, and the ones
 * the publishing file's task read (a person's edit handed to that task).
 */
async function knownVersions(
  caseId: string,
  taskId: string,
  documents: { pageId: string; version: number }[]
): Promise<Map<string, number>> {
  const versions = new Map<string, number>();
  for (const document of documents) {
    versions.set(document.pageId, document.version);
  }
  const task = await withDb((db) =>
    db.orchestratorTask.findFirst({
      where: { id: taskId, caseId },
      select: { result: true },
    })
  );
  for (const page of readTaskResult(task?.result)?.pageInputs ?? []) {
    versions.set(
      page.pageId,
      Math.max(versions.get(page.pageId) ?? 0, page.version)
    );
  }
  return versions;
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Runs a provider call; a throw becomes a scrubbed failure. */
async function safely<T>(
  secrets: Record<string, unknown>,
  run: () => Promise<Result<T, Failure>>
): Promise<Result<T, Failure>> {
  try {
    return await run();
  } catch (error) {
    return Result.err({
      error: scrubProviderError(error, secrets),
      retryable: false,
    });
  }
}

function fromFailure(
  failure: Failure,
  secrets: Record<string, unknown>
): ToolOutcome {
  return {
    ok: false,
    error: scrubProviderError(failure.error, secrets),
    retryable: failure.retryable,
  };
}

function output(value: unknown): ToolOutcome {
  return {
    ok: true,
    output: jsonValueSchema.parse(JSON.parse(JSON.stringify(value))),
  };
}
