import { z } from "zod";
import { htmlToMarkdown } from "../../markdown";
import type { GraphMessage } from "./graph-client";

/**
 * Markdown of Teams messages. Graph bodies are HTML with mentions as
 * `<at id="N">Name</at>` (N indexes the message's `mentions`) and attachments
 * as `<attachment id="…"></attachment>` placeholders. The bot's own mention
 * is removed (it is the address, not part of the request); other mentions
 * become "@Name". Adaptive Cards (the bot's earlier answers) contribute the
 * text of their TextBlocks.
 */

const AT_TAG_RE = /<at\b[^>]*\bid\s*=\s*"?(\d+)"?[^>]*>([\s\S]*?)<\/at>/gi;
const ANY_AT_TAG_RE = /<at\b[^>]*>([\s\S]*?)<\/at>/gi;
const AT_TAG_NAME_RE = /<at\b[^>]*>([\s\S]*?)<\/at>/i;
const ATTACHMENT_TAG_RE = /<attachment\b[^>]*>\s*<\/attachment>/gi;
const LINE_BREAK_RE = /\r?\n/;
const CARD_CONTENT_TYPE_PREFIX = "application/vnd.microsoft.card.";
const CARD_TEXT_MAX_BLOCKS = 50;
const TEXT_CONTENT_TYPE = "text";
const HTML_CONTENT_TYPE = "text/html";

const cardNodeSchema = z.looseObject({
  type: z.string().optional(),
  text: z.string().optional(),
});

const htmlAttachmentSchema = z.looseObject({
  contentType: z.string(),
  content: z.string(),
});

/** Who wrote a message, for transcripts. */
export function messageAuthor(message: GraphMessage): string {
  return (
    message.from?.user?.displayName?.trim() ||
    message.from?.application?.displayName?.trim() ||
    "Unknown"
  );
}

/** The message as markdown, without the mention of the bot whose app id is given. */
export function graphMessageMarkdown(
  message: GraphMessage,
  botAppId: string
): string {
  const content = message.body?.content ?? "";
  const botMentionIds = new Set(
    (message.mentions ?? [])
      .filter(
        (mention) =>
          mention.mentioned?.application?.id?.toLowerCase() ===
          botAppId.toLowerCase()
      )
      .map((mention) => String(mention.id))
  );
  const text =
    message.body?.contentType?.toLowerCase() === TEXT_CONTENT_TYPE
      ? content.trim()
      : htmlToMarkdown(
          content
            .replaceAll(AT_TAG_RE, (_tag, id: string, name: string) =>
              botMentionIds.has(id) ? "" : `@${name}`
            )
            .replaceAll(ATTACHMENT_TAG_RE, "")
        );
  const cards = (message.attachments ?? [])
    .filter((attachment) =>
      attachment.contentType?.startsWith(CARD_CONTENT_TYPE_PREFIX)
    )
    .map((attachment) => cardText(attachment.content ?? null))
    .filter((card) => card !== "");
  return [text, ...cards]
    .filter((part) => part !== "")
    .join("\n\n")
    .trim();
}

/**
 * The text of an incoming activity (the mention), without the bot's mention
 * tags. Teams flattens `text` (list items and paragraphs run together), so
 * the `text/html` attachment's HTML is read when present. There a mention
 * carries attributes (`<at id="0">Name</at>`) that the mention entity's text
 * (`<at>Name</at>`) lacks, so bot mentions are also matched by name.
 */
export function activityText(
  text: string | null | undefined,
  html: string | null | undefined,
  botMentionTexts: readonly string[]
): string {
  let body = html?.trim() ? html : (text ?? "");
  const botNames = new Set<string>();
  for (const mention of botMentionTexts) {
    if (mention) {
      body = body.replaceAll(mention, "");
      const name = AT_TAG_NAME_RE.exec(mention)?.[1]?.trim();
      if (name) {
        botNames.add(name);
      }
    }
  }
  return htmlToMarkdown(
    body.replaceAll(ANY_AT_TAG_RE, (_tag, name: string) =>
      botNames.has(name.trim()) ? "" : `@${name}`
    )
  ).trim();
}

/** The HTML body Teams attaches to a message activity, if any. */
export function activityHtml(
  attachments: readonly unknown[] | null | undefined
): string | null {
  for (const attachment of attachments ?? []) {
    const parsed = htmlAttachmentSchema.safeParse(attachment);
    if (
      parsed.success &&
      parsed.data.contentType.toLowerCase() === HTML_CONTENT_TYPE
    ) {
      return parsed.data.content;
    }
  }
  return null;
}

/** First non-empty line, for titles. */
export function firstLine(markdown: string): string {
  return (
    markdown
      .split(LINE_BREAK_RE)
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

/** Text blocks of an Adaptive Card JSON, one per line (iterative walk). */
function cardText(content: string | null): string {
  if (!content) {
    return "";
  }
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    // observability: (a) parse fallback — a card that is not JSON has no text
    return "";
  }
  const lines: string[] = [];
  const stack: unknown[] = [root];
  while (stack.length > 0 && lines.length < CARD_TEXT_MAX_BLOCKS) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...[...value].reverse());
      continue;
    }
    const node = cardNodeSchema.safeParse(value);
    if (!node.success) {
      continue;
    }
    if (node.data.type === "TextBlock" && node.data.text?.trim()) {
      lines.push(node.data.text.trim());
    }
    stack.push(
      ...Object.values(node.data)
        .filter((child) => typeof child === "object" && child !== null)
        .reverse()
    );
  }
  return lines.join("\n");
}
