import type { JsonObject } from "@repo/api/src/types/common";
import { Result } from "@repo/api/src/types/result";
import { z } from "zod";
import { truncateText } from "../../markdown";
import {
  createChannelThread,
  describeConnectorFailure,
  getConversationMember,
  listConversationMembers,
  type TeamsMember,
} from "./bot-connector";
import { readBotCredentials, type TeamsProviderContext } from "./connection";
import { acquireEntraToken, BOT_FRAMEWORK_SCOPE } from "./entra-token";
import { mentionDisplayName } from "./reply-action";

/**
 * The orchestrator's teams_ask: a new message in a channel that mentions
 * people, found in the channel's team by email. Never throws.
 */

/** Teams drops bot messages above ~28 KB. */
const ASK_BODY_MAX_LENGTH = 20_000;
const ROSTER_PAGES_MAX = 10;

export const teamsAskMentionSchema = z.object({
  email: z.string(),
  id: z.string(),
  aadObjectId: z.string().nullable(),
  name: z.string(),
});
export type TeamsAskMention = z.infer<typeof teamsAskMentionSchema>;

type AskFailure = { error: string; retryable: boolean };
type AskInput = {
  serviceUrl: URL;
  channelId: string;
  emails: string[];
  text: string;
};
type AskPosted = {
  rootMessageId: string;
  conversationId: string;
  mentions: TeamsAskMention[];
};
type AskAccess = {
  context: TeamsProviderContext;
  serviceUrl: URL;
  token: string;
  conversationId: string;
};

export async function postTeamsAsk(
  context: TeamsProviderContext,
  input: AskInput
): Promise<Result<AskPosted, AskFailure>> {
  try {
    const bot = readBotCredentials(context.connection);
    if (!(bot.ok && bot.value)) {
      return failure(
        "The Teams connection has no bot: enter its App ID, tenant ID and client secret.",
        false
      );
    }
    const token = await acquireEntraToken(
      context.http,
      bot.value,
      BOT_FRAMEWORK_SCOPE,
      context.now()
    );
    if (!token.ok) {
      return failure(token.error.message, token.error.retryable);
    }
    const access: AskAccess = {
      context,
      serviceUrl: input.serviceUrl,
      token: token.value,
      conversationId: input.channelId,
    };
    const resolved = await resolveMentions(
      access,
      input.emails.map((email) => email.toLowerCase())
    );
    if (!resolved.ok) {
      return resolved;
    }
    const created = await createChannelThread(context.http, {
      serviceUrl: input.serviceUrl,
      token: token.value,
      tenantId: bot.value.tenantId,
      channelId: input.channelId,
      activity: buildAskActivity(input.text, resolved.value),
    });
    if (!created.ok) {
      return failure(
        describeConnectorFailure(created.error),
        created.error.retryable
      );
    }
    return Result.ok({ ...created.value, mentions: resolved.value });
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : String(error),
      true
    );
  }
}

async function resolveMentions(
  access: AskAccess,
  emails: string[]
): Promise<Result<TeamsAskMention[], AskFailure>> {
  const found = new Map<string, TeamsMember>();
  const missing: string[] = [];
  for (const email of emails) {
    const member = await getConversationMember(access.context.http, {
      serviceUrl: access.serviceUrl,
      token: access.token,
      conversationId: access.conversationId,
      userId: email,
    });
    if (!member.ok) {
      return failure(
        describeConnectorFailure(member.error),
        member.error.retryable
      );
    }
    if (member.value) {
      found.set(email, member.value);
    } else {
      missing.push(email);
    }
  }
  if (missing.length > 0) {
    const roster = await findInRoster(access, missing);
    if (!roster.ok) {
      return roster;
    }
    for (const [email, member] of roster.value) {
      found.set(email, member);
    }
  }
  const unknown = emails.filter((email) => !found.has(email));
  if (unknown.length > 0) {
    return failure(
      `Not in the Teams team of the channel: ${unknown.join(", ")}. Check the email in your rules or add the person to the team.`,
      false
    );
  }
  return Result.ok(
    emails.map((email) => toMention(email, found.get(email) as TeamsMember))
  );
}

/** Pages the roster once, matching emails against `email` and the UPN. */
async function findInRoster(
  access: AskAccess,
  emails: string[]
): Promise<Result<Map<string, TeamsMember>, AskFailure>> {
  const wanted = new Set(emails.map((email) => email.toLowerCase()));
  const found = new Map<string, TeamsMember>();
  let continuationToken: string | null = null;
  for (let page = 0; page < ROSTER_PAGES_MAX; page++) {
    const listed = await listConversationMembers(access.context.http, {
      serviceUrl: access.serviceUrl,
      token: access.token,
      conversationId: access.conversationId,
      continuationToken,
    });
    if (!listed.ok) {
      return failure(
        describeConnectorFailure(listed.error),
        listed.error.retryable
      );
    }
    for (const member of listed.value.members) {
      for (const candidate of [member.email, member.userPrincipalName]) {
        const key = candidate?.toLowerCase();
        if (key && wanted.has(key) && !found.has(key)) {
          found.set(key, member);
        }
      }
    }
    continuationToken = listed.value.continuationToken;
    if (!continuationToken || found.size === wanted.size) {
      break;
    }
  }
  return Result.ok(found);
}

function toMention(email: string, member: TeamsMember): TeamsAskMention {
  const fullName = [member.givenName, member.surname]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    email,
    id: member.id,
    aadObjectId: member.aadObjectId ?? member.objectId ?? null,
    name: mentionDisplayName(member.name || fullName || email),
  };
}

function buildAskActivity(
  text: string,
  mentions: TeamsAskMention[]
): JsonObject {
  const tags = mentions.map((mention) => `<at>${mention.name}</at>`);
  return {
    type: "message",
    textFormat: "markdown",
    text: `${tags.join(" ")}\n\n${truncateText(stripLeadingMentions(text, mentions), ASK_BODY_MAX_LENGTH)}`,
    entities: mentions.map((mention) => ({
      type: "mention",
      text: `<at>${mention.name}</at>`,
      mentioned: { id: mention.id, name: mention.name },
    })),
  };
}

/** The tool adds the @mentions itself: drop a leading "@Name" or "Name:" the model typed. */
function stripLeadingMentions(
  text: string,
  mentions: TeamsAskMention[]
): string {
  let rest = text.trimStart();
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name } of mentions) {
      const escaped = escapeRegExp(name);
      const next = rest
        .replace(
          new RegExp(String.raw`^@${escaped}(?![\p{L}\p{N}])[\s:,]*`, "iu"),
          ""
        )
        .replace(new RegExp(String.raw`^${escaped}\s*:\s*`, "iu"), "");
      if (next !== rest && next.length > 0) {
        rest = next;
        changed = true;
      }
    }
  }
  return rest;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function failure(error: string, retryable: boolean): Result<never, AskFailure> {
  return Result.err({ error, retryable });
}
