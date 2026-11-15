import {
  assertRunnerSecretConfigured,
  RUNNER_JWT_SECRET_ENV,
} from "@repo/auth/runner-jwt-base";
import type { Instrumentation } from "next";

/** The only Next.js runtime that can host the API's Node instrumentation. */
const NODE_RUNTIME = "nodejs";

/** Registers API startup checks and runtime-specific observability wiring. */
export const register = async () => {
  assertRunnerSecretConfigured(RUNNER_JWT_SECRET_ENV);

  // Next compiles this entrypoint for every runtime. Keep the Node-only module
  // behind the runtime branch so Edge instrumentation never traverses Prisma,
  // pg, the OpenTelemetry Node SDK, or the Node-backed observability modules.
  if (process.env.NEXT_RUNTIME === NODE_RUNTIME) {
    const { registerNodeInstrumentation } = await import(
      "./instrumentation.node"
    );
    await registerNodeInstrumentation();
  }
};

/** Reports errors Next.js caught outside any route wrapper. */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  if (process.env.NEXT_RUNTIME !== NODE_RUNTIME) {
    return;
  }
  try {
    const { reportRequestError } = await import(
      "./lib/observability/request-error"
    );
    reportRequestError(error, request, context);
  } catch {
    // observability: fail-open — error reporting must never affect the response
  }
};
