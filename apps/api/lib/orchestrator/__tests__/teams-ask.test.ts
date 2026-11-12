import { describe, expect, it } from "vitest";
import { TeamsTriggerType } from "@/lib/integrations/providers/microsoft-teams/constants";
import type { InboundEvent } from "@/lib/integrations/types";
import {
  checkTeamsAskReply,
  readTeamsAsk,
  TeamsAskIgnoredReason,
} from "@/lib/orchestrator/teams-ask";

const ASK = {
  channelId: "19:qa@thread.tacv2",
  mentions: [
    { email: "an@x.test", id: "29:abc", aadObjectId: "AAD-An", name: "An" },
  ],
  questions: [{ taskId: "t1", questionId: "q1" }],
};

function event(actorId: string | null, triggerType: string): InboundEvent {
  return {
    triggerType,
    actor: actorId ? { id: actorId, displayName: null } : null,
  } as unknown as InboundEvent;
}

describe("checkTeamsAskReply", () => {
  it("accepts a bot-mentioning reply from a mentioned person by Entra id", () => {
    expect(
      checkTeamsAskReply(event("aad-an", TeamsTriggerType.BotMentioned), ASK)
    ).toEqual({ ok: true });
  });

  it("accepts the Teams id", () => {
    expect(
      checkTeamsAskReply(event("29:ABC", TeamsTriggerType.BotMentioned), ASK)
    ).toEqual({ ok: true });
  });

  it("refuses someone who was not mentioned", () => {
    expect(
      checkTeamsAskReply(event("aad-x", TeamsTriggerType.BotMentioned), ASK)
    ).toEqual({ ok: false, reason: TeamsAskIgnoredReason.NotAsked });
  });

  it("refuses a reply without a bot mention", () => {
    expect(
      checkTeamsAskReply(event("aad-an", "microsoft_teams.thread_reply"), ASK)
    ).toEqual({ ok: false, reason: TeamsAskIgnoredReason.NotMentioned });
  });

  it("refuses when the ask message is missing", () => {
    expect(
      checkTeamsAskReply(event("aad-an", TeamsTriggerType.BotMentioned), null)
    ).toEqual({ ok: false, reason: TeamsAskIgnoredReason.NoAsk });
  });

  it("refuses an event without an actor", () => {
    expect(
      checkTeamsAskReply(event(null, TeamsTriggerType.BotMentioned), ASK)
    ).toEqual({ ok: false, reason: TeamsAskIgnoredReason.NotAsked });
  });
});

describe("readTeamsAsk", () => {
  it("reads the stored ask and ignores other payloads", () => {
    expect(readTeamsAsk({ teamsAsk: ASK })?.channelId).toBe(ASK.channelId);
    expect(readTeamsAsk({ teamsAsk: { channelId: "x" } })).toBeNull();
    expect(readTeamsAsk(null)).toBeNull();
  });
});
