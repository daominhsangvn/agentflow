/**
 * Entrypoint: starts telemetry before `index.ts` loads, because index imports
 * `@repo/database` (pg) statically and instrumentation must patch it first.
 */
async function main(): Promise<void> {
  try {
    const { initTelemetry } = await import(
      "@repo/observability/tracing/provider"
    );
    initTelemetry({ handleShutdownSignals: false });
  } catch {
    // observability: telemetry bootstrap itself — fail-open, the server starts without telemetry.
  }
  const { startHttpServer, __testables } = await import("./index.js");
  __testables.installShutdownHandlers(startHttpServer());
}

main().catch((error: unknown) => {
  console.error("MCP server failed to start", error);
  process.exit(1);
});
