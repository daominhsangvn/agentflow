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
