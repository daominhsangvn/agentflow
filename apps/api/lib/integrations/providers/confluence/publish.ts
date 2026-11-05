import type { JsonObject } from "@repo/api/src/types/common";
import { Result } from "@repo/api/src/types/result";
import { HttpMethod, type ProviderContext } from "../../types";
import { markdownToAdf } from "../atlassian/adf";
import {
  attachmentBlocks,
  type PageAttachment,
  type PageFileUpload,
  uploadPageAttachment,
} from "./attachments";
import { readBody } from "./bodies";
import {
  type ConfluenceContext,
  type ConfluenceError,
  ConfluenceErrorKind,
  confluenceRequest,
} from "./client";
import { ConfluenceBodyFormat } from "./constants";
import {
  type AllowedSpaces,
  findSpaceByKey,
  loadAllowedPage,
  loadAllowedSpaces,
  type OperationFailure,
  pageWebUrl,
  parsePageReference,
  toFailure,
} from "./pages";
import { openPage } from "./reads";
import {
  type ConfluencePage,
  confluenceConnectionConfigSchema,
  confluenceCreatedSchema,
  confluenceListSchema,
  confluencePageSchema,
  confluenceSecretsSchema,
} from "./schemas";

/**
 * Used by the orchestrator's page tools: publish a Markdown file as a page
 * (create, or update with a guard for people's edits) with attachments, and
 * read a page back as Markdown. Always space-guarded: a page or parent is
 * used only inside the project connection's spaces.
 */

export type PublishPageInput = {
  title: string;
  markdown: string;
  /** Page to update (id or link); null finds the page by title. */
  page: string | null;
  /** A page reference, "root" (top of the space), or null for the project's parent page. */
  parent: string | null;
  space: string | null;
  files: PageFileUpload[];
  overwrite: boolean;
  /** pageId to the version AgentFlow last published (the case's Documents). */
  recordedVersions: ReadonlyMap<string, number>;
};

export type PublishedPage = {
  pageId: string;
  title: string;
  url: string;
  version: number;
  space: string;
  parentId: string | null;
  created: boolean;
  attachments: string[];
};

export type PageMarkdown = {
  pageId: string;
  title: string;
  url: string;
  version: number;
  space: string | null;
  parentId: string | null;
  lastEditedBy: {
    accountId: string | null;
    byAgentFlow: boolean;
    at: string | null;
  };
  markdown: string;
  truncated: boolean;
};

export const PARENT_ROOT = "root";

export function toConfluenceContext(
  ctx: ProviderContext
): ConfluenceContext | null {
  const config = confluenceConnectionConfigSchema.safeParse(
    ctx.connection.config
  );
  const secrets = confluenceSecretsSchema.safeParse(ctx.connection.secrets);
  if (!(config.success && secrets.success)) {
    return null;
  }
  return {
    ...ctx,
    connection: {
      ...ctx.connection,
      config: config.data,
      secrets: secrets.data,
    },
  };
}

export async function publishMarkdownPage(
  ctx: ConfluenceContext,
  input: PublishPageInput
): Promise<Result<PublishedPage, OperationFailure>> {
  const title = input.title.trim().slice(0, TITLE_MAX);
  if (!title) {
    return fail("The page needs a title.");
  }
  if (input.markdown.length > MARKDOWN_MAX) {
    return fail(
      `The file is too large for a page (${input.markdown.length} characters, at most ${MARKDOWN_MAX}).`
    );
  }
  const spaces = await loadAllowedSpaces(ctx);
  if (!spaces.ok) {
    return spaces;
  }
  const target = await resolveTarget(ctx, spaces.value, input, title);
  if (!target.ok) {
    return target;
  }
  const { existing, spaceId, parentId } = target.value;
  const space = spaces.value.byId.get(spaceId)?.key ?? "";
  const work = { title, markdown: input.markdown, files: input.files };
  if (existing) {
    const guard = guardOverwrite(ctx, existing, input);
    if (guard) {
      return Result.err(guard);
    }
    return updateExisting(ctx, existing, space, work);
  }
  return createNew(ctx, { spaceId, space, parentId }, work);
}

export async function readPageMarkdown(
  ctx: ConfluenceContext,
  reference: string,
  max: number
): Promise<Result<PageMarkdown, OperationFailure>> {
  const opened = await openPage(ctx, reference);
  if (!opened.ok) {
    return opened;
  }
  const { page, spaces } = opened.value;
  const { body, truncated } = readBody(
    page.body?.storage?.value,
    ConfluenceBodyFormat.Markdown,
    max
  );
  const accountId = page.version.authorId ?? null;
  const bot = ctx.connection.account?.externalAccountId ?? null;
  return Result.ok({
    pageId: page.id,
    title: page.title,
    url: pageWebUrl(ctx.connection.config, page),
    version: page.version.number,
    space: spaces.byId.get(page.spaceId)?.key ?? null,
    parentId: page.parentId ?? null,
    lastEditedBy: {
      accountId,
      byAgentFlow: bot !== null && accountId === bot,
      at: page.version.createdAt ?? null,
    },
    markdown: body,
    truncated,
  });
}

const TITLE_MAX = 255;
const MARKDOWN_MAX = 500_000;
const TITLE_MATCH_LIMIT = 25;
const VERSION_MESSAGE = "Published by AgentFlow";

type Target = {
  existing: ConfluencePage | null;
  spaceId: string;
  parentId: string | null;
};

type PageWork = {
  title: string;
  markdown: string;
  files: PageFileUpload[];
};

function fail<T>(
  error: string,
  retryable = false
): Result<T, OperationFailure> {
  return Result.err({ error, retryable });
}

async function resolveTarget(
  ctx: ConfluenceContext,
  spaces: AllowedSpaces,
  input: PublishPageInput,
  title: string
): Promise<Result<Target, OperationFailure>> {
  if (input.page) {
    return resolveGivenPage(ctx, spaces, input.page);
  }
  const place = await resolvePlace(ctx, spaces, input);
  if (!place.ok) {
    return place;
  }
  const { spaceId, parentId } = place.value;
  const matches = await findByTitle(ctx, spaceId, title);
  if (!matches.ok) {
    return matches;
  }
  const found = pickMatch(matches.value, parentId);
  if (found === OTHER_PARENT) {
    const other = matches.value[0];
    const url = other ? pageWebUrl(ctx.connection.config, other) : "";
    return fail(
      `A page titled "${title}" already exists elsewhere in ${spaces.byId.get(spaceId)?.key ?? "the space"} (${url}): pass it as page, or choose another title.`
    );
  }
  return Result.ok({ existing: found, spaceId, parentId });
}

async function resolveGivenPage(
  ctx: ConfluenceContext,
  spaces: AllowedSpaces,
  reference: string
): Promise<Result<Target, OperationFailure>> {
  const pageId = parsePageReference(ctx.connection.config, reference);
  if (!pageId.ok) {
    return fail(pageId.error);
  }
  const page = await loadAllowedPage(ctx, spaces, pageId.value);
  if (!page.ok) {
    return page;
  }
  return Result.ok({
    existing: page.value,
    spaceId: page.value.spaceId,
    parentId: page.value.parentId ?? null,
  });
}

/** The space and parent page a new or titled page belongs to. */
function resolvePlace(
  ctx: ConfluenceContext,
  spaces: AllowedSpaces,
  input: PublishPageInput
): Promise<
  Result<{ spaceId: string; parentId: string | null }, OperationFailure>
> {
  const reference = input.parent ?? spaces.parentPageId;
  if (reference && reference !== PARENT_ROOT) {
    return resolveParentPlace(ctx, spaces, reference, input.space);
  }
  const space = chooseSpace(spaces, input.space);
  return Promise.resolve(
    space.ok ? Result.ok({ spaceId: space.value, parentId: null }) : space
  );
}

async function resolveParentPlace(
  ctx: ConfluenceContext,
  spaces: AllowedSpaces,
  reference: string,
  spaceKey: string | null
): Promise<
  Result<{ spaceId: string; parentId: string | null }, OperationFailure>
> {
  const parentId = parsePageReference(ctx.connection.config, reference);
  if (!parentId.ok) {
    return fail(parentId.error);
  }
  const parent = await loadAllowedPage(ctx, spaces, parentId.value);
  if (!parent.ok) {
    return parent;
  }
  const named = spaceKey ? findSpaceByKey(spaces, spaceKey) : null;
  if (named && named.id !== parent.value.spaceId) {
    return fail(
      `The parent page "${parent.value.title}" is not in space ${named.key}.`
    );
  }
  return Result.ok({
    spaceId: parent.value.spaceId,
    parentId: parent.value.id,
  });
}

function chooseSpace(
  spaces: AllowedSpaces,
  key: string | null
): Result<string, OperationFailure> {
  if (key) {
    const found = findSpaceByKey(spaces, key);
    if (found) {
      return Result.ok(found.id);
    }
    return fail(
      `Not allowed: space ${key} is not one of the project connection's spaces (${spaces.keys.join(", ")}).`
    );
  }
  const [only, ...rest] = spaces.byId.values();
  if (only && rest.length === 0) {
    return Result.ok(only.id);
  }
  return fail(`space: name one of ${spaces.keys.join(", ")}.`);
}

async function findByTitle(
  ctx: ConfluenceContext,
  spaceId: string,
  title: string
): Promise<Result<ConfluencePage[], OperationFailure>> {
  const listed = await confluenceRequest(
    ctx,
    {
      method: HttpMethod.Get,
      path: "api/v2/pages",
      query: { "space-id": spaceId, title, limit: TITLE_MATCH_LIMIT },
    },
    confluenceListSchema
  );
  if (!listed.ok) {
    return Result.err(toFailure(listed.error));
  }
  const pages: ConfluencePage[] = [];
  for (const value of listed.value.results) {
    const parsed = confluencePageSchema.safeParse(value);
    if (parsed.success && parsed.data.title === title) {
      pages.push(parsed.data);
    }
  }
  return Result.ok(pages);
}

const OTHER_PARENT = Symbol("other-parent");

/** The page to update, none, or OTHER_PARENT for a title taken elsewhere. */
function pickMatch(
  matches: ConfluencePage[],
  parentId: string | null
): ConfluencePage | null | typeof OTHER_PARENT {
  if (matches.length === 0) {
    return null;
  }
  if (parentId === null) {
    return matches.length === 1 ? (matches[0] ?? null) : OTHER_PARENT;
  }
  return matches.find((match) => match.parentId === parentId) ?? OTHER_PARENT;
}

/** A refusal when people edited the page since AgentFlow last published it. */
function guardOverwrite(
  ctx: ConfluenceContext,
  page: ConfluencePage,
  input: PublishPageInput
): OperationFailure | null {
  if (input.overwrite) {
    return null;
  }
  const bot = ctx.connection.account?.externalAccountId ?? null;
  const recorded = input.recordedVersions.get(page.id);
  const editedByPeople =
    page.version.authorId !== bot &&
    (recorded === undefined || page.version.number > recorded);
  if (!editedByPeople) {
    return null;
  }
  return {
    error: `"${page.title}" was edited on Confluence since AgentFlow last published it (version ${page.version.number} by someone else): hand the page to the task with task_run files [{page, name}] so the edits are kept, publish again, or pass overwrite: true if people asked to replace it.`,
    retryable: false,
  };
}

async function updateExisting(
  ctx: ConfluenceContext,
  page: ConfluencePage,
  space: string,
  work: PageWork
): Promise<Result<PublishedPage, OperationFailure>> {
  const uploaded = await uploadAll(ctx, page.id, work.files);
  if (!uploaded.ok) {
    return uploaded;
  }
  const version = page.version.number + 1;
  const written = await writeBodyWithAttachments(ctx, {
    pageId: page.id,
    title: work.title,
    markdown: work.markdown,
    version,
    attachments: uploaded.value,
  });
  if (!written.ok) {
    return written;
  }
  return Result.ok({
    pageId: page.id,
    title: work.title,
    url: pageWebUrl(ctx.connection.config, {
      id: page.id,
      _links: written.value._links ?? page._links,
    }),
    version,
    space,
    parentId: page.parentId ?? null,
    created: false,
    attachments: uploaded.value.map((file) => file.name),
  });
}

async function createNew(
  ctx: ConfluenceContext,
  place: { spaceId: string; space: string; parentId: string | null },
  work: PageWork
): Promise<Result<PublishedPage, OperationFailure>> {
  const body: JsonObject = {
    spaceId: place.spaceId,
    status: "current",
    title: work.title,
    ...(place.parentId ? { parentId: place.parentId } : {}),
    body: adfBody(work.markdown, []),
  };
  const created = await confluenceRequest(
    ctx,
    { method: HttpMethod.Post, path: "api/v2/pages", body },
    confluenceCreatedSchema
  );
  if (!created.ok) {
    return Result.err(publishFailure(created.error, work.title));
  }
  const pageId = created.value.id;
  let url = pageWebUrl(ctx.connection.config, created.value);
  let version = 1;
  let attachments: string[] = [];
  if (work.files.length > 0) {
    const uploaded = await uploadAll(ctx, pageId, work.files);
    if (!uploaded.ok) {
      return uploaded;
    }
    version = 2;
    const written = await writeBodyWithAttachments(ctx, {
      pageId,
      title: work.title,
      markdown: work.markdown,
      version,
      attachments: uploaded.value,
    });
    if (!written.ok) {
      return written;
    }
    url = pageWebUrl(ctx.connection.config, {
      id: pageId,
      _links: written.value._links ?? created.value._links,
    });
    attachments = uploaded.value.map((file) => file.name);
  }
  return Result.ok({
    pageId,
    title: work.title,
    url,
    version,
    space: place.space,
    parentId: place.parentId,
    created: true,
    attachments,
  });
}

/** Uploads one file after the other; the first failure stops with what was uploaded. */
async function uploadAll(
  ctx: ConfluenceContext,
  pageId: string,
  files: PageFileUpload[]
): Promise<Result<PageAttachment[], OperationFailure>> {
  const uploaded: PageAttachment[] = [];
  for (const file of files) {
    const result = await uploadPageAttachment(ctx, pageId, file);
    if (!result.ok) {
      const done =
        uploaded.length > 0
          ? ` (uploaded before: ${uploaded.map((entry) => entry.name).join(", ")})`
          : "";
      return Result.err({
        error: `${result.error.error}${done}`,
        retryable: result.error.retryable,
      });
    }
    uploaded.push(result.value);
  }
  return Result.ok(uploaded);
}

/**
 * Writes the page body with its attachments; when Confluence rejects the
 * image blocks (400), writes it again with the link list only.
 */
async function writeBodyWithAttachments(
  ctx: ConfluenceContext,
  options: {
    pageId: string;
    title: string;
    markdown: string;
    version: number;
    attachments: PageAttachment[];
  }
): Promise<Result<{ _links?: ConfluencePage["_links"] }, OperationFailure>> {
  const send = (media: boolean) =>
    confluenceRequest(
      ctx,
      {
        method: HttpMethod.Put,
        path: `api/v2/pages/${encodeURIComponent(options.pageId)}`,
        body: {
          id: options.pageId,
          status: "current",
          title: options.title,
          body: adfBody(
            options.markdown,
            attachmentBlocks(options.pageId, options.attachments, { media })
          ),
          version: { number: options.version, message: VERSION_MESSAGE },
        },
      },
      confluenceCreatedSchema
    );
  let result = await send(true);
  if (
    !result.ok &&
    result.error.kind === ConfluenceErrorKind.BadRequest &&
    options.attachments.length > 0
  ) {
    result = await send(false);
  }
  return result.ok
    ? Result.ok(result.value)
    : Result.err(publishFailure(result.error, options.title));
}

function adfBody(
  markdown: string,
  blocks: ReturnType<typeof attachmentBlocks>
): JsonObject {
  const document = markdownToAdf(markdown);
  return {
    representation: "atlas_doc_format",
    value: JSON.stringify({
      ...document,
      content: [...document.content, ...blocks],
    }),
  };
}

function publishFailure(
  error: ConfluenceError,
  title: string
): OperationFailure {
  if (error.kind === ConfluenceErrorKind.Conflict) {
    return {
      error: `"${title}" changed while publishing: try again.`,
      retryable: true,
    };
  }
  return toFailure(error);
}
