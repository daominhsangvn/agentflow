import { log } from "@repo/observability/log";
import { workflowEventRetentionService } from "@/app/workflows/workflow-event-retention-service";
import { validateCronSecret } from "@/lib/auth/cron-secret";
import { scheduleLogFlush } from "@/lib/route-utils";

export const maxDuration = 300;

/** Daily: deletes workflow events and inbound deliveries older than 30 days. */
export const GET = async (request: Request): Promise<Response> => {
  const denied = validateCronSecret(request, "[prune-inbound-history]");
  if (denied) {
    return denied;
  }

  try {
    const result = await workflowEventRetentionService.prune(new Date());
    log.info("[prune-inbound-history] prune completed", result);
    scheduleLogFlush();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("[prune-inbound-history] prune failed", { error: message });
    scheduleLogFlush();
    return Response.json(
      { ok: false, message: "Something went wrong" },
      { status: 500 }
    );
  }
};
