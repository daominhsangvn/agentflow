"use client";

import type { WorkflowEventSummary } from "@repo/api/src/types/workflow-event";
// Cross-slice: the inline error state, the source labels and the badge tone
// map are owned by the integrations slice.
import { QueryErrorMessage } from "@repo/app/integrations/components/query-error-message";
import { DELIVERY_SOURCE_LABELS } from "@repo/app/integrations/lib/integration-labels";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { Link } from "@repo/navigation/link";
import { useOrgPath } from "@repo/navigation/use-org-path";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import {
  useWorkflowEventPayload,
  useWorkflowEvents,
} from "../hooks/use-workflows";
import {
  WORKFLOW_EVENT_RESULT_LABELS,
  WORKFLOW_EVENT_RESULT_TONES,
} from "../lib/workflow-labels";

const EMPTY_TEXT =
  "No events yet. Events for this workflow's triggers appear here and are kept for 30 days.";

/** Inbound event history of one workflow: what ingest did with each event. */
export function WorkflowEventHistory({
  workflowId,
  isAdmin,
}: Readonly<{ workflowId: string; isAdmin: boolean }>) {
  const buildOrgPath = useOrgPath();
  const events = useWorkflowEvents(workflowId);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const rows = events.data?.pages.flatMap((page) => page.events) ?? [];

  if (events.isLoading) {
    return (
      <div aria-label="Loading events" className="space-y-2" role="status">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (events.error) {
    return (
      <QueryErrorMessage
        error={events.error}
        onRetry={() => {
          events.refetch();
        }}
        title="Couldn't load events"
      />
    );
  }
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{EMPTY_TEXT}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Detail</TableHead>
              {isAdmin ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((event) => (
              <TableRow key={event.id}>
                <TableCell
                  className="whitespace-nowrap text-muted-foreground"
                  title={new Date(event.deliveredAt).toLocaleString()}
                >
                  {formatRelativeTime(event.deliveredAt)}
                </TableCell>
                <TableCell>{DELIVERY_SOURCE_LABELS[event.source]}</TableCell>
                <TableCell className="font-mono text-xs">
                  {event.triggerType}
                </TableCell>
                <TableCell>{event.sourceKey ?? "—"}</TableCell>
                <TableCell>
                  <EventResult
                    event={event}
                    href={eventResultHref(event, workflowId, buildOrgPath)}
                  />
                </TableCell>
                <TableCell
                  className="max-w-[20rem] truncate text-muted-foreground"
                  title={event.detail ?? undefined}
                >
                  {event.detail}
                </TableCell>
                {isAdmin ? (
                  <TableCell>
                    <Button
                      onClick={() => setSelectedEventId(event.id)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Payload
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {events.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            disabled={events.isFetchingNextPage}
            onClick={() => {
              events.fetchNextPage();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {events.isFetchingNextPage ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : null}
            Load more
          </Button>
        </div>
      ) : null}
      {isAdmin ? (
        <EventPayloadDialog
          onClose={() => setSelectedEventId(null)}
          selectedEventId={selectedEventId}
          workflowId={workflowId}
        />
      ) : null}
    </div>
  );
}

function eventResultHref(
  event: WorkflowEventSummary,
  workflowId: string,
  buildOrgPath: (path: string) => string
): string | null {
  if (event.runId) {
    return buildOrgPath(`/workflows/${workflowId}/runs/${event.runId}`);
  }
  if (event.caseId) {
    return buildOrgPath(`/orchestrator/cases/${event.caseId}`);
  }
  return null;
}

function EventResult({
  event,
  href,
}: Readonly<{ event: WorkflowEventSummary; href: string | null }>) {
  const badge = (
    <Badge variant={WORKFLOW_EVENT_RESULT_TONES[event.result]}>
      {WORKFLOW_EVENT_RESULT_LABELS[event.result]}
    </Badge>
  );
  if (href === null) {
    return badge;
  }
  return <Link href={href}>{badge}</Link>;
}

function EventPayloadDialog({
  workflowId,
  selectedEventId,
  onClose,
}: Readonly<{
  workflowId: string;
  selectedEventId: string | null;
  onClose: () => void;
}>) {
  const payload = useWorkflowEventPayload(workflowId, selectedEventId);
  const event = payload.data;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={selectedEventId !== null}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {event
              ? `${event.eventType ?? "Event"} · ${DELIVERY_SOURCE_LABELS[event.source]}`
              : "Event payload"}
          </DialogTitle>
          <DialogDescription>
            The delivery's stored copy, kept for troubleshooting.
          </DialogDescription>
        </DialogHeader>
        <EventPayloadBody
          error={payload.error}
          isLoading={payload.isLoading}
          onRetry={() => {
            payload.refetch();
          }}
          payload={event?.payload ?? null}
        />
      </DialogContent>
    </Dialog>
  );
}

function EventPayloadBody({
  isLoading,
  error,
  payload,
  onRetry,
}: Readonly<{
  isLoading: boolean;
  error: Error | null;
  payload: unknown;
  onRetry: () => void;
}>) {
  if (isLoading) {
    return (
      <div aria-label="Loading payload" role="status">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <QueryErrorMessage
        error={error}
        onRetry={onRetry}
        title="Couldn't load the payload"
      />
    );
  }
  if (payload === null) {
    return (
      <p className="text-muted-foreground text-sm">
        No payload was kept for this delivery.
      </p>
    );
  }
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}
