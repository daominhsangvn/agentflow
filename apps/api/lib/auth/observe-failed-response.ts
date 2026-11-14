import { AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { redactSensitiveText } from "@repo/observability/redact";
import { recordError, setSpanOutcome } from "@repo/observability/span";
import { z } from "zod";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_REASON_LENGTH = 512;
const SERVER_ERROR_STATUS = 500;
const CLIENT_ERROR_STATUS = 400;
const JSON_CONTENT_TYPE = "application/json";

const errorBodySchema = z.object({
  error: z.union([z.string(), z.object({ message: z.string() }).passthrough()]),
});

type RequestLike = { method?: string; url?: string };

/**
 * Surface the reason of a failed (status >= 400) response to telemetry: the
 * active span gets the outcome/reason and one correlated `request.failed` log
 * line is written. Reads a bounded clone of the body; never throws.
 */
export async function observeFailedResponse(
  request: RequestLike,
  response: Response
): Promise<void> {
  try {
    const status = response.status;
    if (status < CLIENT_ERROR_STATUS) {
      return;
    }
    const reason = truncate(
      (await readErrorReason(response)) ?? `HTTP ${status}`
    );
    const isServerError = status >= SERVER_ERROR_STATUS;
    setSpanOutcome(
      isServerError ? AfOutcome.Error : AfOutcome.Rejected,
      reason
    );
    const meta = {
      path: resolvePath(request.url),
      method: request.method ?? "GET",
      status_code: status,
      reason,
    };
    if (isServerError) {
      log.warn("request.failed", meta);
    } else {
      log.info("request.failed", meta);
    }
  } catch {
    // Telemetry must never affect the response.
  }
}

/** Record an exception a wrapper turns into a 500 on the span and in the logs. */
export function observeThrownError(message: string, error: unknown): void {
  try {
    recordError(error);
    const source = error instanceof Error ? error : new Error(String(error));
    log.error(message, {
      "error.name": source.name,
      "error.message": source.message,
      "error.stack": source.stack,
    });
  } catch {
    // Telemetry must never affect the response.
  }
}

async function readErrorReason(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes(JSON_CONTENT_TYPE)) {
    return null;
  }
  const text = await readCapped(response.clone());
  if (!text) {
    return null;
  }
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return null;
    }
    const { error } = parsed.data;
    return typeof error === "string" ? error : error.message;
  } catch {
    return null;
  }
}

async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (bytes < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  // Over the cap: a truncated JSON document cannot be parsed reliably.
  reader.cancel().catch(() => undefined);
  return null;
}

function truncate(reason: string): string {
  return redactSensitiveText(reason).slice(0, MAX_REASON_LENGTH);
}

function resolvePath(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://api.internal").pathname;
  } catch {
    return "/";
  }
}
