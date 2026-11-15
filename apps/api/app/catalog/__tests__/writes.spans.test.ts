import { installInMemorySpans } from "@repo/observability/testing/in-memory-spans";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    catalogItem: { findFirst: vi.fn() },
    apiKey: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const withDb = Object.assign(
    (fn: (client: typeof db) => unknown) => Promise.resolve(fn(db)),
    { tx: (fn: (client: typeof db) => unknown) => Promise.resolve(fn(db)) }
  );
  return { db, withDb };
});

vi.mock("@repo/database", () => ({
  withDb: mocks.withDb,
  ApiKeySource: {
    USER_CREATED: "USER_CREATED",
    DESKTOP_MANAGED: "DESKTOP_MANAGED",
  },
  GitHubInstallationStatus: { ACTIVE: "ACTIVE" },
  SourceOccurrenceType: {},
}));
vi.mock("@repo/storage", () => ({}));
vi.mock("@/app/definition-registry/service", () => ({}));
vi.mock("@/app/search/search-index-service", () => ({
  searchIndexService: {},
}));

import { apiKeysService } from "@/app/api-keys/service";
import { createCatalogItem } from "@/app/catalog/service";

const ERROR_STATUS_CODE = 2;
const ORG_ID = "org-1";
const USER_ID = "user-1";

describe("write spans", () => {
  const memory = installInMemorySpans();

  beforeEach(() => {
    memory.reset();
    vi.clearAllMocks();
  });
  afterAll(() => {
    memory.uninstall();
  });

  it("marks catalog.create_item as an error for a failure result", async () => {
    mocks.db.catalogItem.findFirst.mockResolvedValue(null);

    const result = await createCatalogItem({
      organizationId: ORG_ID,
      userId: USER_ID,
      targetKind: "agent",
      name: "Item",
      parentPackId: "missing-pack",
    } as never);

    expect(result.ok).toBe(false);
    const span = memory.spans().find((s) => s.name === "catalog.create_item");
    expect(span?.status.code).toBe(ERROR_STATUS_CODE);
    expect(span?.attributes["af.org_id"]).toBe(ORG_ID);
  });

  it("keeps the plaintext key, hash and prefix out of api_key spans", async () => {
    mocks.db.apiKey.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "key-1",
          organizationId: ORG_ID,
          userId: USER_ID,
          name: String(args.data.name),
          keyPrefix: String(args.data.keyPrefix),
          keyHash: String(args.data.keyHash),
          scopes: ["read"],
          expiresAt: null,
          lastUsedAt: null,
          createdAt: new Date(),
          revokedAt: null,
        })
    );

    const created = await apiKeysService.generate(ORG_ID, USER_ID, {
      name: "My secret name",
    });

    expect(created.plaintext.startsWith("sk_")).toBe(true);
    const span = memory.spans().find((s) => s.name === "api_key.generate");
    expect(span).toBeDefined();
    expect(span?.attributes["af.key_id"]).toBe("key-1");
    for (const value of Object.values(span?.attributes ?? {})) {
      expect(String(value).startsWith("sk_")).toBe(false);
      expect(String(value)).not.toContain("My secret name");
    }
  });
});
