import { OrchestratorDocumentKind } from "@repo/api/src/types/orchestrator";
import { Result } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPage,
  publishPage,
  resolvePageInputs,
} from "@/app/orchestrator-tools/service/pages";

const TOKEN = "secret-token-value";
const TASK_ID = "0199a5f0-0000-7000-8000-0000000000f9";

const mocks = vi.hoisted(() => ({
  connections: [] as { id: string; key: string }[],
  publishMarkdownPage: vi.fn(),
  readPageMarkdown: vi.fn(),
  findCaseTaskFiles: vi.fn(),
  getLoopAttachment: vi.fn(),
  recordDocument: vi.fn(),
  listCaseDocuments: vi.fn(),
  runtime: null as unknown,
  taskResult: null as unknown,
}));

vi.mock("@repo/database", () => ({
  withDb: (run: (db: unknown) => unknown) =>
    run({
      orchestratorTask: {
        findFirst: () => Promise.resolve({ result: mocks.taskResult }),
      },
      projectConnection: {
        findMany: () => Promise.resolve(mocks.connections),
      },
    }),
}));
vi.mock("@/lib/integrations/project-connections", () => ({
  loadProjectConnectionRuntime: () => Promise.resolve(mocks.runtime),
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  createProviderContext: () => ({ connection: {} }),
}));
vi.mock("@/lib/integrations/providers/confluence/publish", () => ({
  publishMarkdownPage: mocks.publishMarkdownPage,
  readPageMarkdown: mocks.readPageMarkdown,
  toConfluenceContext: (ctx: unknown) => ctx,
}));
vi.mock("@/lib/orchestrator/task-files", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  findCaseTaskFiles: mocks.findCaseTaskFiles,
}));
vi.mock("@/lib/loops/loop-state", () => ({
  getLoopAttachment: mocks.getLoopAttachment,
}));
vi.mock("@/lib/orchestrator/case-documents", () => ({
  recordDocument: mocks.recordDocument,
  listCaseDocuments: mocks.listCaseDocuments,
}));

const context = {
  organizationId: "org",
  projectId: "project",
  caseId: "case",
  conversationId: "conversation",
  turnId: "turn",
  pageKeys: { read: ["docs", "wiki"], publish: ["docs", "wiki"] },
};

const publishInput = {
  file: { taskId: TASK_ID, name: "PRD-LD-6.md" },
  title: "LD-6 · PRD",
  kind: OrchestratorDocumentKind.Prd,
  attachments: [],
  overwrite: false,
};

const page = {
  pageId: "10",
  title: "LD-6 · PRD",
  url: "https://x/wiki/10",
  version: 1,
  space: "ENG",
  parentId: null,
  created: true,
  attachments: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connections = [{ id: "pc1", key: "docs" }];
  mocks.runtime = { connection: { runtime: { secrets: { token: TOKEN } } } };
  mocks.taskResult = null;
  mocks.listCaseDocuments.mockResolvedValue([]);
  mocks.findCaseTaskFiles.mockImplementation(
    (_case: string, refs: { name: string }[]) =>
      Promise.resolve(
        Result.ok(
          refs.map((ref) => ({
            name: ref.name,
            size: 1,
            storageKey: ref.name,
          }))
        )
      )
  );
  mocks.getLoopAttachment.mockResolvedValue(new TextEncoder().encode("# PRD"));
});

describe("publishPage", () => {
  it("refuses without a Confluence connection", async () => {
    mocks.connections = [];
    const result = await publishPage(context, publishInput);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("no Confluence connection");
  });

  it("refuses a connection that is not granted for publishing", async () => {
    mocks.connections = [{ id: "a", key: "docs" }];
    const result = await publishPage(
      { ...context, pageKeys: { read: ["docs"], publish: [] } },
      publishInput
    );
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("granted for publish");
  });

  it("picks the only connection granted for publishing without a key", async () => {
    mocks.connections = [
      { id: "a", key: "docs" },
      { id: "b", key: "wiki" },
    ];
    mocks.publishMarkdownPage.mockResolvedValue(Result.ok(page));
    const result = await publishPage(
      { ...context, pageKeys: { read: ["docs", "wiki"], publish: ["wiki"] } },
      publishInput
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a key granted only for reading", async () => {
    mocks.connections = [{ id: "a", key: "docs" }];
    const result = await publishPage(
      { ...context, pageKeys: { read: ["docs"], publish: [] } },
      { ...publishInput, connection: "docs" }
    );
    expect(result).toMatchObject({ ok: false });
    expect(mocks.publishMarkdownPage).not.toHaveBeenCalled();
  });

  it("asks for a key when there are several connections", async () => {
    mocks.connections = [
      { id: "a", key: "docs" },
      { id: "b", key: "wiki" },
    ];
    const result = await publishPage(context, publishInput);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("docs, wiki");
  });

  it("publishes the file with attachments and records the document", async () => {
    mocks.publishMarkdownPage.mockResolvedValue(
      Result.ok({ ...page, attachments: ["a.png"] })
    );
    const result = await publishPage(context, {
      ...publishInput,
      attachments: [{ taskId: TASK_ID, name: "evidence/a.png" }],
    });
    expect(result.ok).toBe(true);
    const call = mocks.publishMarkdownPage.mock.calls[0]?.[1];
    expect(call.markdown).toBe("# PRD");
    expect(call.files).toHaveLength(1);
    expect(call.files[0].name).toBe("a.png");
    expect(mocks.recordDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "turn",
        document: expect.objectContaining({
          pageId: "10",
          kind: OrchestratorDocumentKind.Prd,
          attachments: ["a.png"],
        }),
      })
    );
  });

  it("refuses a binary file", async () => {
    mocks.getLoopAttachment.mockResolvedValue(
      new Uint8Array([0xff, 0xfe, 0xfd])
    );
    const result = await publishPage(context, publishInput);
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(mocks.publishMarkdownPage).not.toHaveBeenCalled();
  });

  it("scrubs the token from a provider error", async () => {
    mocks.publishMarkdownPage.mockResolvedValue(
      Result.err({ error: `bad ${TOKEN}`, retryable: true })
    );
    const result = await publishPage(context, publishInput);
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(mocks.recordDocument).not.toHaveBeenCalled();
  });
});

describe("publishPage known versions", () => {
  const readByTask = (version: number) => ({
    reply: null,
    error: null,
    pageInputs: [
      {
        pageId: "10",
        title: "LD-6 · PRD",
        url: "https://x/wiki/10",
        version,
        name: "page.md",
        content: "# PRD",
        size: 5,
      },
    ],
  });

  it("counts the version the source task read as known", async () => {
    mocks.listCaseDocuments.mockResolvedValue([{ pageId: "10", version: 2 }]);
    mocks.taskResult = readByTask(3);
    mocks.publishMarkdownPage.mockResolvedValue(Result.ok(page));
    const result = await publishPage(context, publishInput);
    expect(result.ok).toBe(true);
    const versions = mocks.publishMarkdownPage.mock.calls[0]?.[1]
      .recordedVersions as Map<string, number>;
    expect(versions.get("10")).toBe(3);
  });

  it("keeps the recorded version when the task did not read the edit", async () => {
    mocks.listCaseDocuments.mockResolvedValue([{ pageId: "10", version: 2 }]);
    mocks.taskResult = null;
    mocks.publishMarkdownPage.mockResolvedValue(Result.ok(page));
    await publishPage(context, publishInput);
    const versions = mocks.publishMarkdownPage.mock.calls[0]?.[1]
      .recordedVersions as Map<string, number>;
    expect(versions.get("10")).toBe(2);
  });

  it("refuses two attachments with the same name", async () => {
    const result = await publishPage(context, {
      ...publishInput,
      attachments: [
        { taskId: TASK_ID, name: "a/x.png" },
        { taskId: TASK_ID, name: "b/x.png" },
      ],
    });
    expect(result).toMatchObject({ ok: false });
    expect(mocks.publishMarkdownPage).not.toHaveBeenCalled();
  });

  it("refuses attachments over the total size cap", async () => {
    mocks.findCaseTaskFiles.mockResolvedValue(
      Result.ok([
        { name: "a.md", size: 1, storageKey: "a" },
        { name: "big.png", size: 30 * 1024 * 1024, storageKey: "b" },
      ])
    );
    const result = await publishPage(context, {
      ...publishInput,
      attachments: [{ taskId: TASK_ID, name: "big.png" }],
    });
    expect(result).toMatchObject({ ok: false });
    expect(mocks.publishMarkdownPage).not.toHaveBeenCalled();
  });
});

describe("getPage", () => {
  it("returns the markdown and version", async () => {
    mocks.readPageMarkdown.mockResolvedValue(
      Result.ok({
        ...page,
        markdown: "# Hi",
        truncated: false,
        lastEditedBy: {},
      })
    );
    const result = await getPage(context, { page: "10" });
    expect(result).toMatchObject({
      ok: true,
      output: { markdown: "# Hi", version: 1 },
    });
  });
});

describe("getPage grants", () => {
  it("refuses a connection that is not granted for reading", async () => {
    const result = await getPage(
      { ...context, pageKeys: { read: [], publish: [] } },
      { page: "10" }
    );
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain("granted for read");
    expect(mocks.readPageMarkdown).not.toHaveBeenCalled();
  });
});

describe("resolvePageInputs", () => {
  it("returns content and size", async () => {
    mocks.readPageMarkdown.mockResolvedValue(
      Result.ok({ ...page, markdown: "é", truncated: false, lastEditedBy: {} })
    );
    const result = await resolvePageInputs(context, [
      { page: "10", name: "PRD-LD-6.md" },
    ]);
    expect(result).toEqual(
      Result.ok([
        expect.objectContaining({
          pageId: "10",
          name: "PRD-LD-6.md",
          content: "é",
          size: 2,
        }),
      ])
    );
  });

  it("refuses a truncated page", async () => {
    mocks.readPageMarkdown.mockResolvedValue(
      Result.ok({ ...page, markdown: "x", truncated: true, lastEditedBy: {} })
    );
    const result = await resolvePageInputs(context, [
      { page: "10", name: "a.md" },
    ]);
    expect(result.ok).toBe(false);
  });
});
