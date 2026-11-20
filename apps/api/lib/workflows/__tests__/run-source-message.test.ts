import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import { describe, expect, it } from "vitest";
import type { InboundEvent } from "@/lib/integrations/types";
import { buildRunSource, readRunSource } from "@/lib/workflows/engine/run-data";

const MESSAGE_MAX = 8000;

function eventWith(message: InboundEvent["message"]): InboundEvent {
  return {
    item: {
      provider: IntegrationProviderKey.MicrosoftTeams,
      externalId: "ext-1",
      key: "teams-1",
      url: null,
      title: null,
      container: null,
    },
    actor: null,
    attributes: {},
    occurredAt: new Date("2026-11-01T10:00:00Z"),
    message,
  } as InboundEvent;
}

describe("run source message", () => {
  it("keeps the triggering message", () => {
    const source = readRunSource(
      buildRunSource(eventWith({ id: "m1", parentId: null, text: "do it" }))
    );

    expect(source?.message).toEqual({ id: "m1", text: "do it" });
  });

  it("truncates a long message", () => {
    const source = readRunSource(
      buildRunSource(
        eventWith({ id: null, parentId: null, text: "x".repeat(9000) })
      )
    );

    expect(source?.message?.text).toHaveLength(MESSAGE_MAX);
  });

  it("stores null without a message and reads an older row as null", () => {
    const built = buildRunSource(eventWith(undefined));
    expect(readRunSource(built)?.message).toBeNull();

    const { message: _omitted, ...older } = built;
    expect(readRunSource(older)?.message).toBeNull();
  });
});
