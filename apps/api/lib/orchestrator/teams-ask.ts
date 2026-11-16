import { z } from "zod";
import { teamsAskMentionSchema } from "@/lib/integrations/providers/microsoft-teams/channel-ask";
import { TeamsTriggerType } from "@/lib/integrations/providers/microsoft-teams/constants";
import type { InboundEvent } from "@/lib/integrations/types";

/** The `orchestrator_anchors.artifact` of a message posted by teams_ask. */
export const TEAMS_ASK_ANCHOR_ARTIFACT = "teams_ask";

export const teamsAskPayloadSchema = z.looseObject({
  teamsAsk: z.object({
    channelId: z.string(),
    connectionKey: z.string().optional(),
    threadRef: z.string().optional(),
    mentions: z.array(teamsAskMentionSchema).min(1),
    questions: z.array(
      z.object({ taskId: z.string(), questionId: z.string() })
    ),
  }),
});

export type TeamsAskPayload = z.infer<typeof teamsAskPayloadSchema>["teamsAsk"];

export const TeamsAskIgnoredReason = {
  NotMentioned: "ask_reply_without_bot_mention",
  NoAsk: "ask_message_missing",
} as const;
export type TeamsAskIgnoredReason =
  (typeof TeamsAskIgnoredReason)[keyof typeof TeamsAskIgnoredReason];

/** The teams_ask details stored on the ask message's payload, or null. */
export function readTeamsAsk(payload: unknown): TeamsAskPayload | null {
  const parsed = teamsAskPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.teamsAsk : null;
}

/**
 * A message in a teams_ask thread is accepted from anyone, as long as it
 * mentions the bot. `asked` says whether the writer is one of the people the
 * original ask mentioned.
 */
export function checkTeamsAskReply(
  event: InboundEvent,
  ask: TeamsAskPayload | null
): { ok: true; asked: boolean } | { ok: false; reason: TeamsAskIgnoredReason } {
  if (!ask) {
    return { ok: false, reason: TeamsAskIgnoredReason.NoAsk };
  }
  if (event.triggerType !== TeamsTriggerType.BotMentioned) {
    return { ok: false, reason: TeamsAskIgnoredReason.NotMentioned };
  }
  return { ok: true, asked: isAskedPerson(ask, event.actor?.id) };
}

/** What the delivery says when a reply in a teams_ask thread is dropped. */
export function describeTeamsAskIgnored(reason: TeamsAskIgnoredReason): string {
  switch (reason) {
    case TeamsAskIgnoredReason.NotMentioned:
      return "Teams ask thread: the reply does not mention the bot";
    default:
      return "Teams ask thread: the ask message is missing";
  }
}

/** Whether the actor is one of the people the original ask mentioned (Entra object id or Teams id). */
export function isAskedPerson(
  ask: TeamsAskPayload,
  actorId: string | null | undefined
): boolean {
  if (!actorId) {
    return false;
  }
  const id = actorId.toLowerCase();
  return ask.mentions.some(
    (mention) =>
      mention.aadObjectId?.toLowerCase() === id ||
      mention.id.toLowerCase() === id
  );
}

/** Payload of an inbound message in a teams_ask thread. */
export const teamsAskThreadPayloadSchema = z.looseObject({
  teamsAskThread: z.object({
    askRef: z.string(),
    threadRef: z.string().optional(),
    taskId: z.string().nullable().optional(),
    actorId: z.string().nullable(),
    asked: z.boolean(),
  }),
});

export type TeamsAskThreadMessage = z.infer<
  typeof teamsAskThreadPayloadSchema
>["teamsAskThread"];

export function readTeamsAskThread(
  payload: unknown
): TeamsAskThreadMessage | null {
  const parsed = teamsAskThreadPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.teamsAskThread : null;
}

export const teamsAskSummaryEntrySchema = z.object({
  taskId: z.string(),
  questionId: z.string(),
  question: z.string(),
  answer: z.string(),
});

export type TeamsAskSummaryEntry = z.infer<typeof teamsAskSummaryEntrySchema>;

/** Payload of the bot's own post in a teams_ask thread. */
export const teamsAskReplyPayloadSchema = z.looseObject({
  teamsAskReply: z.object({
    askRef: z.string(),
    threadRef: z.string().optional(),
    mentions: z.array(teamsAskMentionSchema),
    summary: z.array(teamsAskSummaryEntrySchema).nullable(),
  }),
});

export type TeamsAskReplyPost = z.infer<
  typeof teamsAskReplyPayloadSchema
>["teamsAskReply"];

export function readTeamsAskReply(payload: unknown): TeamsAskReplyPost | null {
  const parsed = teamsAskReplyPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.teamsAskReply : null;
}

/** The Teams thread root an ask lives in; old asks have no threadRef and are their own root. */
export function askThreadRef(ask: TeamsAskPayload, askRef: string): string {
  return ask.threadRef ?? askRef;
}

/** The task whose questions an ask relayed, or null when it relayed none. */
export function askTaskId(ask: TeamsAskPayload): string | null {
  return ask.questions[0]?.taskId ?? null;
}
