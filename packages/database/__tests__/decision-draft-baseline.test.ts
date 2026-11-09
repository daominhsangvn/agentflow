import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BASELINE_PATH = join(
  import.meta.dirname,
  "../prisma/migrations/20261019000000_init/migration.sql"
);

const statements = readFileSync(BASELINE_PATH, "utf8").split(";\n");

describe("init baseline: orchestrator_decisions draft", () => {
  it("creates the draft and draft_result columns", () => {
    const create = statements.find((statement) =>
      statement.includes("CREATE TABLE public.orchestrator_decisions (")
    );
    expect(create).toBeDefined();
    expect(create).toContain("draft jsonb");
    expect(create).toContain("draft_result jsonb");
  });
});
