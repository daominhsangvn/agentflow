import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadTeamsAskChannels,
  resolveTeamsAskChannel,
  type TeamsAskChannelOption,
} from "@/lib/orchestrator/teams-ask-channels";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({ projectConnection: { findMany: mocks.findMany } }),
}));

const QA: TeamsAskChannelOption = {
  alias: "qa-backend",
  channelId: "19:qabackend@thread.tacv2",
  connectionKey: "teams",
  projectConnectionId: "pc-1",
};
const BA: TeamsAskChannelOption = {
  alias: "ba",
  channelId: "19:ba@thread.tacv2",
  connectionKey: "teams",
  projectConnectionId: "pc-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadTeamsAskChannels", () => {
  it("does not query without granted keys", async () => {
    expect(await loadTeamsAskChannels("org", "proj", new Set())).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("flattens the ask channels of the granted connections", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "pc-1",
        key: "teams",
        settings: { askChannels: ["qa-backend = 19:qabackend@thread.tacv2"] },
      },
      { id: "pc-2", key: "bad", settings: { askChannels: "nope" } },
    ]);
    const options = await loadTeamsAskChannels(
      "org",
      "proj",
      new Set(["teams", "bad"])
    );
    expect(options).toEqual([QA]);
  });
});

describe("resolveTeamsAskChannel", () => {
  it("matches an alias case-insensitively", () => {
    const result = resolveTeamsAskChannel([QA, BA], {
      channel: " QA-Backend ",
    });
    expect(result.ok && result.value).toEqual(QA);
  });

  it("matches a channel id", () => {
    const result = resolveTeamsAskChannel([QA, BA], {
      channel: "19:BA@thread.tacv2",
    });
    expect(result.ok && result.value).toEqual(BA);
  });

  it("refuses an unknown alias and lists the allowed ones", () => {
    const result = resolveTeamsAskChannel([QA, BA], { channel: "devops" });
    expect(result.ok ? "" : result.error).toContain(
      "Allowed: qa-backend (teams), ba (teams)."
    );
  });

  it("takes the only channel when none is named", () => {
    const result = resolveTeamsAskChannel([QA], {});
    expect(result.ok && result.value).toEqual(QA);
  });

  it("requires a channel when there are two", () => {
    const result = resolveTeamsAskChannel([QA, BA], {});
    expect(result.ok ? "" : result.error).toContain(
      "channel is required: one of qa-backend (teams), ba (teams)"
    );
  });

  it("refuses when there is no ask channel", () => {
    const result = resolveTeamsAskChannel([], {});
    expect(result.ok ? "" : result.error).toContain("No Ask channel");
  });

  it("needs connection when an alias is on two connections", () => {
    const other = {
      ...QA,
      connectionKey: "teams2",
      projectConnectionId: "pc-2",
    };
    const ambiguous = resolveTeamsAskChannel([QA, other], {
      channel: "qa-backend",
    });
    expect(ambiguous.ok ? "" : ambiguous.error).toContain(
      "pass connection (teams, teams2)"
    );
    const chosen = resolveTeamsAskChannel([QA, other], {
      channel: "qa-backend",
      connection: "teams2",
    });
    expect(chosen.ok && chosen.value).toEqual(other);
  });

  it("refuses an unknown connection", () => {
    const result = resolveTeamsAskChannel([QA], { connection: "x" });
    expect(result.ok ? "" : result.error).toBe("connection: one of teams.");
  });
});
