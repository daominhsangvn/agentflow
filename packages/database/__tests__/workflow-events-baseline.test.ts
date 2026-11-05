import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BASELINE_PATH = join(
  import.meta.dirname,
  "../prisma/migrations/20261019000000_init/migration.sql"
);

const statements = readFileSync(BASELINE_PATH, "utf8").split(";\n");

function statementContaining(fragment: string): string {
  const found = statements.find((statement) => statement.includes(fragment));
  if (!found) {
    throw new Error(`No baseline statement contains: ${fragment}`);
  }
  return found;
}

describe("init baseline: workflow_events", () => {
  it("creates the table with the result and received_at columns", () => {
    const create = statementContaining("CREATE TABLE public.workflow_events (");
    expect(create).toContain("result character varying(16) NOT NULL");
    expect(create).toContain(
      "received_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL"
    );
  });

  it("indexes events newest first per workflow", () => {
    const index = statementContaining(
      "CREATE INDEX workflow_events_workflow_id_received_at_idx"
    );
    expect(index).toContain("(workflow_id, received_at DESC)");
  });

  it("indexes delivery_id for the retention cascade", () => {
    const index = statementContaining(
      "CREATE INDEX workflow_events_delivery_id_idx"
    );
    expect(index).toContain("(delivery_id)");
  });

  it("cascades events when the delivery is deleted", () => {
    const fk = statementContaining("workflow_events_delivery_id_fkey");
    expect(fk).toContain("ON DELETE CASCADE");
  });

  it("keeps events when a run or case is deleted", () => {
    expect(statementContaining("workflow_events_run_id_fkey")).toContain(
      "ON DELETE SET NULL"
    );
    expect(statementContaining("workflow_events_case_id_fkey")).toContain(
      "ON DELETE SET NULL"
    );
  });
});
