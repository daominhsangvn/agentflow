import { observeThrownError } from "@/lib/auth/observe-failed-response";

type RequestErrorRequest = { path: string; method: string };
type RequestErrorContext = { routePath?: string; routeType?: string };

/** Log and record an error Next.js caught outside any route wrapper. */
export function reportRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext
): void {
  observeThrownError("request.unhandled_error", error, {
    path: request.path.split("?")[0],
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    digest: readDigest(error),
  });
}

function readDigest(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const { digest } = error as { digest: unknown };
    return typeof digest === "string" ? digest : undefined;
  }
  return undefined;
}
