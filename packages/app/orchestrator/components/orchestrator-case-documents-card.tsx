import {
  DOCUMENT_KIND_LABELS,
  type OrchestratorCaseDocument,
} from "@repo/api/src/types/orchestrator";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";

/** Pages the orchestrator published for the case (page_publish). */
export function OrchestratorCaseDocumentsCard({
  documents,
}: Readonly<{ documents: OrchestratorCaseDocument[] }>) {
  if (documents.length === 0) {
    return null;
  }
  return (
    <Card data-testid="orchestrator-case-documents">
      <CardHeader>
        <CardTitle className="text-base">Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {documents.map((document) => (
            <li
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
              key={document.pageId}
            >
              <span className="w-36 shrink-0 text-muted-foreground">
                {DOCUMENT_KIND_LABELS[document.kind]}
              </span>
              <a
                className="font-medium hover:underline"
                href={document.url}
                rel="noreferrer"
                target="_blank"
              >
                {document.title}
              </a>
              <span className="text-muted-foreground">v{document.version}</span>
              <span className="text-muted-foreground">
                {formatRelativeTime(new Date(document.publishedAt))}
              </span>
              {document.attachments.length > 0 ? (
                <span className="text-muted-foreground">
                  {document.attachments.length} attachments
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
