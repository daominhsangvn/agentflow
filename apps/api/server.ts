import { createServer } from "node:http";
import { config as loadDotenv } from "dotenv";

/**
 * Starts telemetry before anything that imports `pg`, the gateway or the cron
 * runner: instrumentation patches modules at evaluation time, so every other
 * import in this file is dynamic and runs afterwards. Next's own
 * `instrumentation.node.ts` runs later inside the same process (through a
 * different module copy) and is a no-op because the SDK state is global.
 * Fail-open: telemetry never blocks the cold start.
 */
async function startTelemetry(): Promise<void> {
  try {
    loadEnvFilesForTelemetry();
    const { initTelemetry } = await import(
      "@repo/observability/tracing/provider"
    );
    initTelemetry();
  } catch {
    // observability: (d) telemetry start is fail-open — the server starts without telemetry.
  }
}

async function main(): Promise<void> {
  await startTelemetry();

  const { AfAttribute, AfOutcome } = await import(
    "@repo/observability/af-attributes"
  );
  const { setSpanOutcome, withSpan } = await import("@repo/observability/span");
  const { default: next } = await import("next");
  const { initDesktopGatewaySocketServer } = await import(
    "./lib/desktop-gateway-socket-server"
  );
  const { trackRequestCompleted } = await import(
    "./lib/observability/request-completed-log"
  );
  const { cronJobName, startSelfHostedCronRunner } = await import(
    "./lib/self-hosted-cron"
  );

  const dev = process.env.NODE_ENV !== "production";
  const hostname = process.env.HOST ?? "0.0.0.0";
  const port = Number.parseInt(process.env.PORT ?? "3002", 10);

  const app = next({
    dev,
    hostname,
    port,
  });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((request, response) => {
    trackRequestCompleted(request, response);
    handle(request, response).catch((error) => {
      console.error("Failed handling API request", error);
      if (response.headersSent) {
        response.end();
      } else {
        response.statusCode = 500;
        response.end("Internal Server Error");
      }
    });
  });

  initDesktopGatewaySocketServer(server);

  server.listen(port, hostname, () => {
    // Keep output aligned with Next default readiness log.
    console.log(`> Ready on http://${hostname}:${port}`);
    // Self-hosted has no platform cron: workflow ticks and the loop reaper
    // are driven in-process (SELF_HOSTED_CRON_DISABLED=true opts out).
    const stopCronRunner = startSelfHostedCronRunner({
      port,
      hostname,
      runInSpan: (job, fn) =>
        withSpan(
          `cron.${cronJobName(job.path)}`,
          { [AfAttribute.CronJob]: job.path },
          async (span) => {
            const result = await fn();
            if (!result.ok) {
              setSpanOutcome(AfOutcome.Error, result.reason, span);
            }
            return result;
          },
          { root: true }
        ),
    });
    server.on("close", stopCronRunner);
  });
}

main().catch((error) => {
  console.error("Failed to start API server", error);
  process.exit(1);
});

/**
 * Telemetry starts before `next()` loads the `.env*` files, so the OTEL_* settings
 * kept in `apps/api/.env.local` during development would be missing at init.
 * Load the same files Next loads, in its precedence order; dotenv never overrides
 * a variable that is already set, so container/compose env still wins. In
 * production images there are no `.env*` files and this is a no-op.
 */
function loadEnvFilesForTelemetry(): void {
  const mode =
    process.env.NODE_ENV === "production" ? "production" : "development";
  loadDotenv({
    path: [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"],
    quiet: true,
  });
}
