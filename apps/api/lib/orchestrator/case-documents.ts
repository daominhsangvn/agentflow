import {
  OrchestratorDocumentKind,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import { z } from "zod";
import { getPrismaErrorCode } from "@/lib/db-utils";

/**
 * The pages the orchestrator published (page_publish), kept as `document`
 * messages of the case's conversations. CASE.md lists them under "Documents"
 * and the case page shows them (docs/orchestrator.md).
 */

const PRISMA_UNIQUE_VIOLATION = "P2002";
const DOCUMENTS_MAX = 200;

export const documentPayloadSchema = z.object({
  pageId: z.string(),
  title: z.string(),
  url: z.string(),
  version: z.number().int(),
  kind: z.enum(OrchestratorDocumentKind),
  space: z.string().nullable(),
  attachments: z.array(z.string()).default([]),
});
export type DocumentPayload = z.infer<typeof documentPayloadSchema>;

export type CaseDocument = DocumentPayload & {
  conversationId: string;
  publishedAt: Date;
};

/** Records a publish as a message of the turn that made it. */
export async function recordDocument(input: {
  organizationId: string;
  conversationId: string;
  turnId: string;
  document: DocumentPayload;
}): Promise<void> {
  const { document } = input;
  try {
    await withDb((db) =>
      db.orchestratorMessage.create({
        data: {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          origin: OrchestratorMessageOrigin.Internal,
          kind: OrchestratorMessageKind.Document,
          actor: null,
          text: `Published "${document.title}" (version ${document.version}): ${document.url}`,
          payload: document,
          externalRef: null,
          dedupKey: `document:${input.turnId}:${document.pageId}:${document.version}`,
          turnId: input.turnId,
        },
      })
    );
  } catch (error) {
    if (getPrismaErrorCode(error) !== PRISMA_UNIQUE_VIOLATION) {
      throw error;
    }
  }
}

/** The case's pages, the newest publish of each, in the order they were first published. */
export async function listCaseDocuments(
  organizationId: string,
  caseId: string
): Promise<CaseDocument[]> {
  const rows = await withDb((db) =>
    db.orchestratorMessage.findMany({
      where: {
        organizationId,
        kind: OrchestratorMessageKind.Document,
        conversation: { caseId },
      },
      orderBy: { createdAt: "desc" },
      take: DOCUMENTS_MAX,
      select: { conversationId: true, payload: true, createdAt: true },
    })
  );
  const newest = new Map<string, CaseDocument>();
  const firstSeen = new Map<string, number>();
  for (const row of rows) {
    const parsed = documentPayloadSchema.safeParse(row.payload);
    if (!parsed.success) {
      continue;
    }
    const pageId = parsed.data.pageId;
    if (!newest.has(pageId)) {
      newest.set(pageId, {
        ...parsed.data,
        conversationId: row.conversationId,
        publishedAt: row.createdAt,
      });
    }
    firstSeen.set(pageId, row.createdAt.getTime());
  }
  return [...newest.values()].sort(
    (a, b) => (firstSeen.get(a.pageId) ?? 0) - (firstSeen.get(b.pageId) ?? 0)
  );
}
