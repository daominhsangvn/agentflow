import { withDb } from "@repo/database";
import {
  cleanFileName,
  uploadContentType,
} from "@/app/integration-tools/service/attachments";
import { getLoopAttachment } from "@/lib/loops/loop-state";
import { findCaseTaskFiles } from "@/lib/orchestrator/task-files";

/** A stored task file ready to be sent to the browser. */
export type CaseTaskFileContent = {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
};

/**
 * The bytes of a file a task of the case collected. Null when the task is not
 * a task of this organization's case, the file is unknown or not stored, or
 * the storage read fails.
 */
export async function readCaseTaskFile(
  organizationId: string,
  caseId: string,
  taskId: string,
  name: string
): Promise<CaseTaskFileContent | null> {
  const task = await withDb((db) =>
    db.orchestratorTask.findFirst({
      where: { id: taskId, caseId, organizationId },
      select: { id: true },
    })
  );
  if (!task) {
    return null;
  }
  const found = await findCaseTaskFiles(caseId, [{ taskId, name }]);
  if (!found.ok) {
    return null;
  }
  const stored = found.value[0];
  if (!stored) {
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = await getLoopAttachment(stored.storageKey);
  } catch {
    return null;
  }
  const fileName = cleanFileName(name) ?? "file";
  return {
    bytes,
    fileName,
    contentType: previewableType(uploadContentType(null, fileName)),
  };
}

const OCTET_STREAM = "application/octet-stream";
const PREVIEWABLE_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "application/json"]);

function previewableType(type: string): string {
  if (!PREVIEWABLE_TYPES.has(type)) {
    return OCTET_STREAM;
  }
  return TEXT_TYPES.has(type) ? `${type}; charset=utf-8` : type;
}
