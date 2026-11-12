import { describe, expect, it } from "vitest";
import {
  teamsAskChannels,
  teamsClaimedChannels,
  teamsProjectDefinition,
  teamsProjectSettingsSchema,
} from "../project";
import { channelNameOfLink, TEAMS_INVALID_CHANNEL_ERROR } from "../thread-ref";

const ID = "19:ABC@thread.tacv2";
const LINK = `https://teams.microsoft.com/l/channel/${encodeURIComponent("19:def@thread.tacv2")}/QA%20Backend?groupId=1`;

function parse(askChannels: string[], channels: string[] = []) {
  return teamsProjectSettingsSchema.safeParse({ channels, askChannels });
}

describe("teams project settings askChannels", () => {
  it("defaults to an empty list for old settings", () => {
    const parsed = teamsProjectSettingsSchema.parse({ channels: [] });
    expect(parsed.askChannels).toEqual([]);
  });

  it("stores name = lower-cased id and re-parses to itself", () => {
    const parsed = parse([`QA-Backend = ${ID}`]);
    expect(parsed.success && parsed.data.askChannels).toEqual([
      "qa-backend = 19:abc@thread.tacv2",
    ]);
    const again = parse(parsed.success ? parsed.data.askChannels : []);
    expect(again.success && again.data.askChannels).toEqual(
      parsed.success && parsed.data.askChannels
    );
  });

  it("takes the alias from the channel name of a link", () => {
    const parsed = parse([LINK]);
    expect(parsed.success && parsed.data.askChannels).toEqual([
      "qa-backend = 19:def@thread.tacv2",
    ]);
  });

  it("refuses a bare id without a name", () => {
    const parsed = parse([ID]);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("needs a name");
  });

  it("refuses a bad alias", () => {
    expect(parse([`bad name! = ${ID}`]).success).toBe(false);
  });

  it("refuses duplicate aliases and duplicate channels", () => {
    expect(parse([`a = ${ID}`, "a = 19:other@thread.tacv2"]).success).toBe(
      false
    );
    expect(parse([`a = ${ID}`, `b = ${ID}`]).success).toBe(false);
  });

  it("refuses an invalid channel", () => {
    const parsed = parse(["a = nope"]);
    expect(parsed.error?.issues[0]?.message).toBe(TEAMS_INVALID_CHANNEL_ERROR);
  });

  it("claims each ask channel once, also when listed in channels", () => {
    const settings = teamsProjectSettingsSchema.parse({
      channels: [ID],
      askChannels: [`a = ${ID}`, "b = 19:other@thread.tacv2"],
    });
    expect(teamsClaimedChannels(settings)).toEqual([
      "19:abc@thread.tacv2",
      "19:other@thread.tacv2",
    ]);
    expect(teamsProjectDefinition.containers(settings)).toEqual(
      teamsClaimedChannels(settings)
    );
    expect(teamsAskChannels(settings).map((c) => c.alias)).toEqual(["a", "b"]);
  });
});

describe("channelNameOfLink", () => {
  it("returns the name of a channel link", () => {
    expect(channelNameOfLink(LINK)).toBe("QA Backend");
  });

  it("is null for ids and message links", () => {
    expect(channelNameOfLink(ID)).toBeNull();
    expect(
      channelNameOfLink(
        `https://teams.microsoft.com/l/message/${encodeURIComponent("19:a@thread.tacv2")}/123`
      )
    ).toBeNull();
  });
});
