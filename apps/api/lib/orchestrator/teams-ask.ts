import { z } from "zod";
import { teamsAskMentionSchema } from "@/lib/integrations/providers/microsoft-teams/channel-ask";
import { TeamsTriggerType } from "@/lib/integrations/providers/microsoft-teams/constants";
import type { InboundEvent } from "@/lib/integrations/types";

/** The `orchestrator_anchors.artifact` of a message posted by teams_ask. */
export const TEAMS_ASK_ANCHOR_ARTIFACT = "teams_ask";

export const teamsAskPayloadSchema = z.looseObject({
  teamsAsk: z.object({
    channelId: z.string(),
    mentions: z.array(teamsAskMentionSchema).min(1),
    questions: z.array(
      z.object({ taskId: z.string(), questionId: z.string() })
    ),
  }),
});

export type TeamsAskPayload = z.infer<typeof teamsAskPayloadSchema>["teamsAsk"];

export const TeamsAskIgnoredReason = {
  NotMentioned: "ask_reply_without_bot_mention",
  NotAsked: "ask_reply_from_someone_not_asked",
  NoAsk: "ask_message_missing",
} as const;
export type TeamsAskIgnoredReason =
  (typeof TeamsAskIgnoredReason)[keyof typeof TeamsAskIgnoredReason];

/** The teams_ask details stored on the ask message's payload, or null. */
export function readTeamsAsk(payload: unknown): TeamsAskPayload | null {
  const parsed = teamsAskPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.teamsAsk : null;
}

/** A reply in a teams_ask thread counts only when it mentions the bot and comes from a person the ask mentioned. */
export function checkTeamsAskReply(
  event: InboundEvent,
  ask: TeamsAskPayload | null
): { ok: true } | { ok: false; reason: TeamsAskIgnoredReason } {
  if (!ask) {
    return { ok: false, reason: TeamsAskIgnoredReason.NoAsk };
  }
  if (event.triggerType !== TeamsTriggerType.BotMentioned) {
    return { ok: false, reason: TeamsAskIgnoredReason.NotMentioned };
  }
  const actorId = event.actor?.id.toLowerCase();
  const asked = ask.mentions.some(
    (mention) =>
      actorId !== undefined &&
      (mention.aadObjectId?.toLowerCase() === actorId ||
        mention.id.toLowerCase() === actorId)
  );
  return asked
    ? { ok: true }
    : { ok: false, reason: TeamsAskIgnoredReason.NotAsked };
}

/** What the delivery says when a reply in a teams_ask thread is dropped. */
export function describeTeamsAskIgnored(reason: TeamsAskIgnoredReason): string {
  switch (reason) {
    case TeamsAskIgnoredReason.NotMentioned:
      return "Teams ask thread: the reply does not mention the bot";
    case TeamsAskIgnoredReason.NotAsked:
      return "Teams ask thread: the reply is not from a person the question was asked to";
    default:
      return "Teams ask thread: the ask message is missing";
  }
}
