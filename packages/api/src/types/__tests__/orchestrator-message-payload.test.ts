import { describe, expect, it } from "vitest";
import {
  readOrchestratorMessageAttachments,
  readOrchestratorMessageTeamsAskPeople,
} from "../orchestrator.ts";

describe("readOrchestratorMessageAttachments", () => {
  it("reads valid refs", () => {
    expect(
      readOrchestratorMessageAttachments({
        attachments: [{ taskId: "t1", name: "a.md", extra: 1 }],
      })
    ).toEqual([{ taskId: "t1", name: "a.md" }]);
  });

  it("returns [] when missing or malformed", () => {
    expect(readOrchestratorMessageAttachments(null)).toEqual([]);
    expect(readOrchestratorMessageAttachments({})).toEqual([]);
    expect(
      readOrchestratorMessageAttachments({ attachments: [{ taskId: 1 }] })
    ).toEqual([]);
  });
});

describe("readOrchestratorMessageTeamsAskPeople", () => {
  it("reads the mentioned names", () => {
    expect(
      readOrchestratorMessageTeamsAskPeople({
        teamsAsk: { mentions: [{ name: "An" }, { name: "Binh" }] },
      })
    ).toEqual(["An", "Binh"]);
  });

  it("returns null when absent or malformed", () => {
    expect(readOrchestratorMessageTeamsAskPeople({})).toBeNull();
    expect(readOrchestratorMessageTeamsAskPeople(undefined)).toBeNull();
    expect(
      readOrchestratorMessageTeamsAskPeople({ teamsAsk: { mentions: "x" } })
    ).toBeNull();
  });
});
