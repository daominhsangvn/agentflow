import { log } from "@repo/observability/log";
import { runInLinkedSpan } from "@repo/observability/span";

const WAIT_UNTIL_SPAN_NAME = "background.wait_until";

/**
 * Keep background work alive past the response.
 *
 * Self-hosted deployments run a long-lived Node process, so the promise keeps
 * running on its own; what matters is that a rejection is observed (an
 * unhandled rejection would terminate the process) and that the work shows up
 * in a background span linked to the request span that scheduled it.
 *
 * Pass a promise (already started) or a thunk. The thunk form starts the work
 * inside the linked span, so its child spans and logs attach to it.
 *
 * Call sites keep the same shape as before (`waitUntil(promise)`), so the
 * "never fire-and-forget; always wrap with waitUntil" rule still applies.
 */
export function waitUntil(
  work: Promise<unknown> | (() => Promise<unknown>),
  name = WAIT_UNTIL_SPAN_NAME
): void {
  runInLinkedSpan(
    name,
    {},
    typeof work === "function" ? work : () => work
  ).catch((error: unknown) => {
    log.error("[waitUntil] background task failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
