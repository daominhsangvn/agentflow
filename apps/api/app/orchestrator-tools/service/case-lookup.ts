import { withDb } from "@repo/database";
import { z } from "zod";
import { renderCase } from "@/lib/orchestrator/case-render";
import { caseLink, refused, type ToolOutcome, type TurnContext } from "./turn";

/**
 * case_lookup: reads the CASE.md of the cases of another item in the same
 * project (any workflow), read only (docs/orchestrator.md).
 */

export const ITEM_CASES_MAX = 10;
export const LOOKUP_CASE_MAX = 20_000;
export const ITEM_KEY_RE = /^[\w.#/-]{1,200}$/;

export const itemKeySchema = z.string().trim().regex(ITEM_KEY_RE);

export const caseLookupInputSchema = z.object({ itemKey: itemKeySchema });

type CaseLookupInput = z.infer<typeof caseLookupInputSchema>;

export type ItemCase = {
  id: string;
  status: string;
  title: string;
  sourceKey: string | null;
  workflowId: string;
  workflowName: string;
};

/** The cases of this project about one item, never the caller's own. */
export async function findItemCases(
  context: TurnContext,
  itemKey: string
): Promise<ItemCase[]> {
  const rows = await withDb((db) =>
    db.orchestratorCase.findMany({
      where: {
        organizationId: context.organizationId,
        projectId: context.projectId,
        id: { not: context.caseId },
        sourceKey: { endsWith: `:${itemKey}`, mode: "insensitive" },
      },
      select: {
        id: true,
        status: true,
        title: true,
        sourceKey: true,
        workflowId: true,
        workflow: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: ITEM_CASES_MAX,
    })
  );
  // LIKE treats `_` as a wildcard: keep the exact (case-insensitive) suffix.
  const suffix = `:${itemKey}`.toLowerCase();
  const exact = rows.filter((row) =>
    row.sourceKey?.toLowerCase().endsWith(suffix)
  );
  return exact.map((row) => ({
    id: row.id,
    status: row.status,
    title: row.title,
    sourceKey: row.sourceKey,
    workflowId: row.workflowId,
    workflowName: row.workflow.name,
  }));
}

export async function lookupCases(
  context: TurnContext,
  input: CaseLookupInput
): Promise<ToolOutcome> {
  if (!context.features.caseLookup) {
    return refused(
      "case_lookup is off for this workflow: agent.orchestrator.caseLookup (docs/orchestrator.md)."
    );
  }
  const { itemKey } = input;
  const found = await findItemCases(context, itemKey);
  const cases: LookedUpCase[] = [];
  for (const item of found) {
    const markdown = await renderCase(item.id);
    cases.push({
      caseId: item.id,
      workflow: item.workflowName,
      status: item.status,
      title: item.title,
      caseUrl: await caseLink({ ...context, caseId: item.id }),
      case: markdown.slice(0, LOOKUP_CASE_MAX),
    });
  }
  return {
    ok: true,
    output: {
      itemKey,
      cases,
      note:
        cases.length === 0
          ? `No case of this project is about ${itemKey}.`
          : "Read only: to record changes there, follow your side-conversation steps.",
    },
  };
}

type LookedUpCase = {
  caseId: string;
  workflow: string;
  status: string;
  title: string;
  caseUrl: string | null;
  case: string;
};
