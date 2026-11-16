import { describe, expect, it } from "vitest";
import { TeamsTriggerType } from "@/lib/integrations/providers/microsoft-teams/constants";
import type { InboundEvent } from "@/lib/integrations/types";
import {
  checkTeamsAskReply,
  isAskedPerson,
  readTeamsAsk,
  readTeamsAskReply,
  readTeamsAskThread,
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
  it("marks a bot-mentioning reply from a mentioned person by Entra id as asked", () => {
    expect(
      checkTeamsAskReply(event("aad-an", TeamsTriggerType.BotMentioned), ASK)
    ).toEqual({ ok: true, asked: true });
  });

  it("marks the Teams id as asked", () => {
    expect(
      checkTeamsAskReply(event("29:ABC", TeamsTriggerType.BotMentioned), ASK)
    ).toEqual({ ok: true, asked: true });
  });

  it("accepts someone who was not mentioned as not asked", () => {
    expect(
      checkTeamsAskReply(event("aad-x", TeamsTriggerType.BotMentioned), ASK)
    ).toEqual({ ok: true, asked: false });
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

  it("accepts an event without an actor as not asked", () => {
    expect(
      checkTeamsAskReply(event(null, TeamsTriggerType.BotMentioned), ASK)
    ).toEqual({ ok: true, asked: false });
  });
});

describe("isAskedPerson", () => {
  it("matches by Entra id or Teams id, ignoring case", () => {
    expect(isAskedPerson(ASK, "aad-an")).toBe(true);
    expect(isAskedPerson(ASK, "29:ABC")).toBe(true);
    expect(isAskedPerson(ASK, "aad-x")).toBe(false);
  });

  it("is false without an actor id", () => {
    expect(isAskedPerson(ASK, null)).toBe(false);
    expect(isAskedPerson(ASK, undefined)).toBe(false);
    expect(isAskedPerson(ASK, "")).toBe(false);
  });
});

describe("readTeamsAsk", () => {
  it("reads the stored ask and ignores other payloads", () => {
    expect(readTeamsAsk({ teamsAsk: ASK })?.channelId).toBe(ASK.channelId);
    expect(readTeamsAsk({ teamsAsk: { channelId: "x" } })).toBeNull();
    expect(readTeamsAsk(null)).toBeNull();
  });
});

describe("readTeamsAskThread", () => {
  it("reads a thread message payload", () => {
    const thread = { askRef: "root", actorId: "aad-an", asked: true };
    expect(
      readTeamsAskThread({ via: "teams", teamsAskThread: thread })
    ).toEqual(thread);
    expect(
      readTeamsAskThread({ teamsAskThread: { ...thread, actorId: null } })
        ?.actorId
    ).toBeNull();
  });

  it("returns null for malformed payloads", () => {
    expect(
      readTeamsAskThread({ teamsAskThread: { askRef: "root" } })
    ).toBeNull();
    expect(readTeamsAskThread(null)).toBeNull();
  });
});

describe("readTeamsAskReply", () => {
  const entry = { taskId: "t1", questionId: "q1", question: "Q?", answer: "A" };

  it("reads a post with and without a summary", () => {
    expect(
      readTeamsAskReply({
        teamsAskReply: {
          askRef: "root",
          mentions: ASK.mentions,
          summary: [entry],
        },
      })?.summary
    ).toEqual([entry]);
    expect(
      readTeamsAskReply({
        teamsAskReply: { askRef: "root", mentions: [], summary: null },
      })?.summary
    ).toBeNull();
  });

  it("returns null for malformed payloads", () => {
    expect(
      readTeamsAskReply({
        teamsAskReply: {
          askRef: "root",
          mentions: [],
          summary: [{ taskId: 1 }],
        },
      })
    ).toBeNull();
    expect(readTeamsAskReply({})).toBeNull();
  });
});
