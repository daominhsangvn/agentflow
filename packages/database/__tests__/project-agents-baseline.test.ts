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

describe("init baseline: project_agents", () => {
  it("creates the table", () => {
    const create = statementContaining("CREATE TABLE public.project_agents (");
    expect(create).toContain("compute_target_id uuid NOT NULL");
    expect(create).toContain("project_id uuid NOT NULL");
  });

  it("allows an Agent once per project", () => {
    const index = statementContaining(
      "project_agents_project_id_compute_target_id_key"
    );
    expect(index).toContain("UNIQUE");
    expect(index).toContain("(project_id, compute_target_id)");
  });

  it.each([
    "project_agents_organization_id_fkey",
    "project_agents_project_id_fkey",
    "project_agents_compute_target_id_fkey",
  ])("cascades on %s", (name) => {
    const fk = statementContaining(`ADD CONSTRAINT ${name}`);
    expect(fk).toContain("ON DELETE CASCADE");
  });
});

describe("init baseline: project_agent_contacts", () => {
  it("creates the table with the one-recipient CHECK", () => {
    const create = statementContaining(
      "CREATE TABLE public.project_agent_contacts ("
    );
    expect(create).toContain("project_agent_id uuid NOT NULL");
    expect(create).toContain("user_id uuid,");
    expect(create).toContain("email character varying(320)");
    expect(create).toContain(
      "CONSTRAINT project_agent_contacts_one_recipient CHECK (((user_id IS NULL) <> (email IS NULL)))"
    );
  });

  it("keeps a member once per Agent", () => {
    const index = statementContaining(
      "project_agent_contacts_project_agent_id_user_id_key"
    );
    expect(index).toContain("UNIQUE");
    expect(index).toContain("(project_agent_id, user_id)");
  });

  it("keeps an email once per Agent", () => {
    const index = statementContaining(
      "project_agent_contacts_project_agent_id_email_key"
    );
    expect(index).toContain("UNIQUE");
    expect(index).toContain("(project_agent_id, email)");
  });

  it.each([
    "project_agent_contacts_project_agent_id_fkey",
    "project_agent_contacts_user_id_fkey",
  ])("cascades on %s", (name) => {
    const fk = statementContaining(`ADD CONSTRAINT ${name}`);
    expect(fk).toContain("ON DELETE CASCADE");
  });
});
