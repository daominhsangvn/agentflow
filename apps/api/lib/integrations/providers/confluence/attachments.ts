import { Result } from "@repo/api/src/types/result";
import { HttpMethod } from "../../types";
import type { AdfBlockNode, AdfListItem } from "../atlassian/adf";
import { type ConfluenceContext, confluenceRequest } from "./client";
import { type OperationFailure, toFailure } from "./pages";
import { confluenceAttachmentsSchema } from "./schemas";

/**
 * Files published with a Confluence page (test evidence, screenshots):
 * uploaded to the page's attachments with the v1 API, which creates the
 * attachment or adds a version of the one with the same name, so publishing
 * again is idempotent. Image attachments are then shown in the page body as
 * ADF media (by the upload's file id) and every file is listed with a link.
 */

export type PageFileUpload = {
  name: string;
  contentType: string;
  bytes: Uint8Array;
};

export type PageAttachment = {
  id: string;
  name: string;
  contentType: string;
  fileId: string | null;
  url: string;
};

export async function uploadPageAttachment(
  ctx: ConfluenceContext,
  pageId: string,
  file: PageFileUpload
): Promise<Result<PageAttachment, OperationFailure>> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
    file.name
  );
  form.append("minorEdit", "true");
  const uploaded = await confluenceRequest(
    ctx,
    {
      method: HttpMethod.Put,
      path: `rest/api/content/${encodeURIComponent(pageId)}/child/attachment`,
      // Confluence refuses multipart uploads without it (XSRF check).
      headers: { "x-atlassian-token": "no-check" },
      body: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    },
    confluenceAttachmentsSchema
  );
  if (!uploaded.ok) {
    const failure = toFailure(uploaded.error);
    return Result.err({
      error: `Confluence could not attach ${file.name}: ${failure.error}`,
      retryable: failure.retryable,
    });
  }
  const [attachment] = uploaded.value.results;
  if (!attachment) {
    return Result.err({
      error: `Confluence did not return the attachment of ${file.name}.`,
      retryable: false,
    });
  }
  const { siteUrl } = ctx.connection.config;
  const download = attachment._links?.download;
  return Result.ok({
    id: attachment.id,
    name: attachment.title || file.name,
    contentType: attachment.extensions?.mediaType ?? file.contentType,
    fileId: attachment.extensions?.fileId ?? null,
    url: download
      ? `${siteUrl}/wiki${download}`
      : `${siteUrl}/wiki/pages/viewpageattachments.action?pageId=${encodeURIComponent(pageId)}`,
  });
}

/** ADF blocks that show the files below a page body. */
export function attachmentBlocks(
  pageId: string,
  files: readonly PageAttachment[],
  options: { media: boolean }
): AdfBlockNode[] {
  if (files.length === 0) {
    return [];
  }
  const images: AdfBlockNode[] = [];
  for (const file of files) {
    if (
      options.media &&
      file.fileId &&
      file.contentType.toLowerCase().startsWith("image/")
    ) {
      images.push({
        type: "mediaSingle",
        attrs: { layout: "center" },
        content: [
          {
            type: "media",
            attrs: {
              type: "file",
              id: file.fileId,
              collection: `contentId-${pageId}`,
            },
          },
        ],
      });
    }
  }
  const links: AdfListItem[] = files.map((file) => ({
    type: "listItem",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: file.name,
            marks: [{ type: "link", attrs: { href: file.url } }],
          },
        ],
      },
    ],
  }));
  return [
    ...images,
    {
      type: "paragraph",
      content: [{ type: "text", text: "Attachments", marks: [STRONG] }],
    },
    { type: "bulletList", content: links },
  ];
}

const UPLOAD_TIMEOUT_MS = 60_000;
const STRONG = { type: "strong" } as const;
