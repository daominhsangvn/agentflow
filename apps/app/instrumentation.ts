import type { Instrumentation } from "next";

/** The only Next.js runtime that can host the Node OpenTelemetry SDK. */
const NODE_RUNTIME = "nodejs";

/** Registers runtime-specific observability wiring. */
export const register = async () => {
  // Next compiles this entrypoint for every runtime. Keep the Node-only module
  // behind the runtime branch so Edge and browser bundles never traverse the
  // OpenTelemetry Node SDK.
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
