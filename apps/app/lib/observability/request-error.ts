import { log } from "@repo/observability/log";

type RequestErrorRequest = { path: string; method: string };
type RequestErrorContext = { routePath?: string; routeType?: string };

/** Log an error Next.js caught while rendering or handling a request. */
export function reportRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext
): void {
  log.error("request.unhandled_error", {
    path: request.path.split("?")[0],
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    digest: readDigest(error),
    error,
  });
}

function readDigest(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const { digest } = error as { digest: unknown };
    return typeof digest === "string" ? digest : undefined;
  }
  return undefined;
}
