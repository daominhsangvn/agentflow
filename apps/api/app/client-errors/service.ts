import type {
  ClientErrorRecord,
  ClientErrorReport,
} from "@repo/api/src/types/client-errors";
import { ClientErrorLevel } from "@repo/api/src/types/client-errors";
import { log } from "@repo/observability/log";
import { FixedWindowRateLimiter } from "@/lib/fixed-window-rate-limiter";

const CLIENT_ERROR_MAX_RECORDS_PER_MINUTE = 30;
const CLIENT_ERROR_WINDOW_MS = 60_000;

const limiter = new FixedWindowRateLimiter({
  maxRequests: CLIENT_ERROR_MAX_RECORDS_PER_MINUTE,
  windowMs: CLIENT_ERROR_WINDOW_MS,
});

type ClientErrorAuth = { userId: string; organizationId: string };

export const clientErrorService = {
  record(
    auth: ClientErrorAuth,
    report: ClientErrorReport
  ): { limited: boolean } {
    let kept = 0;
    for (const record of report.records) {
      if (!limiter.attempt(auth.userId, Date.now())) {
        continue;
      }
      kept += 1;
      logClientError(auth, record);
    }
    return { limited: kept === 0 };
  },
};

function logClientError(auth: ClientErrorAuth, record: ClientErrorRecord) {
  const write = record.level === ClientErrorLevel.Warn ? log.warn : log.error;
  write("client.error", {
    kind: record.kind,
    name: record.name,
    message: record.message,
    stack: record.stack,
    path: record.path,
    digest: record.digest,
    ...prefixAttributes(record.attributes),
    userId: auth.userId,
    organizationId: auth.organizationId,
  });
}

function prefixAttributes(
  attributes: ClientErrorRecord["attributes"]
): Record<string, string | number | boolean> {
  const prefixed: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    prefixed[`client.${key}`] = value;
  }
  return prefixed;
}
