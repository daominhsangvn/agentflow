import {
  OrchestratorDocumentKind,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      orchestratorMessage: {
        create: mocks.create,
        findMany: mocks.findMany,
      },
    }),
}));

import { listCaseDocuments, recordDocument } from "../case-documents";

const payload = (
  pageId: string,
  version: number,
  title = `Page ${pageId}`
) => ({
  pageId,
  title,
  url: `https://x/wiki/${pageId}`,
  version,
  kind: OrchestratorDocumentKind.Prd,
  space: "ENG",
  attachments: [],
});

const row = (data: unknown, minute: number) => ({
  conversationId: "conv-1",
  payload: data,
  createdAt: new Date(2026, 9, 28, 9, minute),
});

beforeEach(() => {
  mocks.create.mockReset();
  mocks.findMany.mockReset();
});

describe("listCaseDocuments", () => {
  it("keeps the newest version per page in first-publish order and skips bad payloads", async () => {
    // newest first, as the query returns them
    mocks.findMany.mockResolvedValue([
      row(payload("b", 1), 40),
      row({ nope: true }, 30),
      row(payload("a", 2, "Page a v2"), 20),
      row(payload("a", 1), 10),
    ]);

    const documents = await listCaseDocuments("org-1", "case-1");

    expect(documents.map((d) => [d.pageId, d.version, d.title])).toEqual([
      ["a", 2, "Page a v2"],
      ["b", 1, "Page b"],
    ]);
    expect(documents[0]?.conversationId).toBe("conv-1");
    expect(mocks.findMany.mock.calls[0]?.[0].where).toMatchObject({
      organizationId: "org-1",
      kind: OrchestratorMessageKind.Document,
      conversation: { caseId: "case-1" },
    });
  });
});

describe("recordDocument", () => {
  it("writes a document message of the turn", async () => {
    await recordDocument({
      organizationId: "org-1",
      conversationId: "conv-1",
      turnId: "turn-1",
      document: payload("a", 2),
    });

    expect(mocks.create.mock.calls[0]?.[0].data).toMatchObject({
      organizationId: "org-1",
      conversationId: "conv-1",
      origin: OrchestratorMessageOrigin.Internal,
      kind: OrchestratorMessageKind.Document,
      turnId: "turn-1",
      externalRef: null,
      dedupKey: "document:turn-1:a:2",
      payload: payload("a", 2),
    });
  });

  it("ignores a repeated record of the same publish", async () => {
    mocks.create.mockRejectedValue({ code: "P2002" });
    await expect(
      recordDocument({
        organizationId: "org-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        document: payload("a", 2),
      })
    ).resolves.toBeUndefined();
  });
});
