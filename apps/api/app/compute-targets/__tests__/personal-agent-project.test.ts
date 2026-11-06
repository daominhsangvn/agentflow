import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindFirst } = vi.hoisted(() => ({ mockFindFirst: vi.fn() }));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({ project: { findFirst: mockFindFirst } }),
}));

import { checkPersonalAgentProject } from "../personal-agent-project";

const personal = (projectKey: string) => ({
  personalRunner: { projectKey, parallel: false },
});

describe("checkPersonalAgentProject", () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
  });

  it("accepts an automatic Agent without a query", async () => {
    const result = await checkPersonalAgentProject("org-1", {});
    expect(result.ok).toBe(true);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("accepts a personal Agent whose project exists, scoped to the organization", async () => {
    mockFindFirst.mockResolvedValue({ id: "p1" });
    const result = await checkPersonalAgentProject("org-1", personal("PRO-1"));
    expect(result.ok).toBe(true);
    expect(mockFindFirst.mock.calls[0][0].where).toEqual({
      organizationId: "org-1",
      slug: "PRO-1",
    });
  });

  it("refuses an unknown project key", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await checkPersonalAgentProject("org-1", personal("PRO-9"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(
        "Project PRO-9 is not in this organization"
      );
    }
  });
});
