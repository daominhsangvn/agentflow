import { HttpMethod, type SourceItemRelation } from "../../types";
import {
  ADO_API_VERSION,
  type AdoContext,
  adoRequest,
  workItemWebUrl,
} from "./client";
import {
  ADO_PREDECESSOR_RELATION,
  ADO_SUCCESSOR_RELATION,
  AdoField,
} from "./constants";
import {
  type AdoRelation,
  type AdoWorkItemFields,
  adoWorkItemBatchSchema,
  parseWorkItemId,
  readWorkItemFields,
} from "./schemas";

const WORK_ITEM_URL_ID_RE = /\/workItems\/(\d+)$/i;
const DEPENDENCY_LIMIT = 50;

/**
 * Reads the work items this one waits for (`blockedBy`) and the ones waiting
 * for it (`blocks`) from its dependency relations. Titles and states come
 * from one batch request; when it fails the relations are listed without
 * them, so a read never fails because of the lookup.
 */
export async function fetchAdoDependencies(
  ctx: AdoContext,
  relations: AdoRelation[] | null | undefined,
  projectFallback: string | null
): Promise<{ blockedBy: SourceItemRelation[]; blocks: SourceItemRelation[] }> {
  const blockedByIds = relationIds(relations, ADO_PREDECESSOR_RELATION);
  const blocksIds = relationIds(relations, ADO_SUCCESSOR_RELATION);
  const ids = [...new Set([...blockedByIds, ...blocksIds])];
  if (ids.length === 0) {
    return { blockedBy: [], blocks: [] };
  }
  const details = await fetchDetails(ctx, ids);
  const toRelation = (id: number): SourceItemRelation => {
    const fields = details.get(id);
    return {
      key: `#${id}`,
      title: fields?.[AdoField.Title] ?? null,
      status: fields?.[AdoField.State] ?? null,
      url: workItemWebUrl(
        ctx.connection.config.organizationUrl,
        fields?.[AdoField.TeamProject] ?? projectFallback,
        id
      ),
    };
  };
  return {
    blockedBy: blockedByIds.map(toRelation),
    blocks: blocksIds.map(toRelation),
  };
}

function relationIds(
  relations: AdoRelation[] | null | undefined,
  relationType: string
): number[] {
  const ids = new Set<number>();
  for (const relation of relations ?? []) {
    if (relation.rel !== relationType || !relation.url) {
      continue;
    }
    const match = WORK_ITEM_URL_ID_RE.exec(relation.url)?.[1];
    const id = match ? parseWorkItemId(match) : null;
    if (id !== null) {
      ids.add(id);
    }
  }
  return [...ids].slice(0, DEPENDENCY_LIMIT);
}

async function fetchDetails(
  ctx: AdoContext,
  ids: number[]
): Promise<Map<number, AdoWorkItemFields>> {
  const details = new Map<number, AdoWorkItemFields>();
  const result = await adoRequest(
    ctx,
    {
      method: HttpMethod.Get,
      path: "_apis/wit/workitems",
      query: {
        ids: ids.join(","),
        fields: [AdoField.Title, AdoField.State, AdoField.TeamProject].join(
          ","
        ),
        errorPolicy: "omit",
        "api-version": ADO_API_VERSION,
      },
    },
    adoWorkItemBatchSchema
  );
  if (!result.ok) {
    ctx.log.warn("Azure DevOps dependency titles unavailable", {
      connectionId: ctx.connection.id,
      kind: result.error.kind,
      status: result.error.status,
    });
    return details;
  }
  for (const item of result.value.value) {
    if (item) {
      details.set(item.id, readWorkItemFields(item.fields));
    }
  }
  return details;
}
