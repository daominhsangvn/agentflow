# @repo/observability

OpenTelemetry for AgentFlow: structured logs, spans and metrics, exported over OTLP to
the self-hosted SigNoz (see [docs/self-hosting.md](../../docs/self-hosting.md#observability-signoz)).
Used by `apps/api`, `apps/app`, `apps/mcp`, `apps/relay` and the desktop runner.

## Modules

| Import | Purpose |
|---|---|
| `@repo/observability/log` | `log.info/warn/error`: JSON or pretty stdout plus an OTel log record. Safe in browser bundles. |
| `@repo/observability/span` | `withSpan`, `setSpanOutcome`, `recordError`, `setActiveSpanAttributes`, `addActiveSpanEvent`, `runInLinkedSpan`, `getActiveTraceparent`. Server only. |
| `@repo/observability/af-attributes` | `AfAttribute` (attribute keys) and `AfOutcome` (outcome values). SDK-free. |
| `@repo/observability/tracing/provider` | `initTelemetry()`, `shutdownTelemetry()`: the NodeSDK (traces, logs, metrics; http, undici, pg and Prisma instrumentations). |
| `@repo/observability/telemetry/metrics` | `emitQueueMetric`, `emitProtocolMetric`, `emitDbPoolMetric`: `count:` becomes an OTel Counter, `value:` a Gauge. |
| `@repo/observability/testing/in-memory-spans` | `installInMemorySpans()` for tests: records finished spans, status and attributes. |

## Configuration

Standard OpenTelemetry variables only:

- `OTEL_EXPORTER_OTLP_ENDPOINT`: on/off switch. Unset means no export.
- `OTEL_SERVICE_NAME` (`af-api`, `af-app`, `af-mcp`, `af-runner`; the `af-` prefix is dropped to get the log `origin`).
- `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` (head sampling ratio, default 1).
- `OTEL_SDK_DISABLED=true`: off even when an endpoint is set.
- `LOG_FORMAT=json|pretty`: stdout format (JSON in production).
- `LOG_LEVEL=debug|info|warn|error`: minimum level for stdout and OTel logs (case-insensitive). Default
  `info` in production, `debug` elsewhere. An invalid value falls back to the default and logs
  `telemetry.log_level_invalid` once.

Dev: start SigNoz with `docker compose --profile observability up -d` and set `OTEL_EXPORTER_OTLP_ENDPOINT`; unset means console only. Prod compose sets it to the collector.

Datadog (`DD_*`, `ddtags`, the HTTP intake) is gone.

### Browser constraint

`log.ts`, `af-attributes.ts`, `log-attributes.ts` and `redact.ts` are bundled into browsers.
They must not import `@opentelemetry/*` or Node modules. The browser exports nothing; it
only sends a `traceparent` header. Server code that needs the SDK imports `span`
or `tracing/provider`.

## Fail-open and redaction

Telemetry never fails a process. A missing or unreachable collector, a bootstrap error
or an exporter error leaves telemetry disabled or dropped; requests and startup continue.

Redaction has two layers: in process (`redact.ts`: sensitive keys, secret-shaped and email
values, applied to log meta and to span attributes and error reasons), and the collector's
`redaction` processor, which repeats the key and value patterns.

## How to add a span

Wrap the whole body of a service operation, keeping its signature and return value:

```ts
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { setSpanOutcome, withSpan } from "@repo/observability/span";

export function startTask(input: Input) {
  return withSpan(
    "orchestrator.start_task",
    { [AfAttribute.CaseId]: input.caseId, [AfAttribute.TurnId]: input.turnId },
    async (span) => {
      const result = await doWork(input);
      if (!result.ok) {
        setSpanOutcome(AfOutcome.Error, result.error.message, span);
        log.error("orchestrator.start_task_failed", { caseId: input.caseId });
      }
      return result;
    }
  );
}
```

Rules:

1. Names are `<domain>.<operation>` in snake case, low cardinality, never with ids
   (`loop.launch`, `workflow.advance_run`, `integration.http`, `cron.workflows`).
2. Attributes are `AfAttribute.*` keys plus `af.outcome`, ids only. Never emails, prompts,
   bodies, or URLs with queries or tokens.
3. Wrap the whole body; use `return await` inside try blocks.
4. Thrown errors are recorded by `withSpan`. When the function catches and swallows, logs,
   or returns a failure value (`Result.err`, `{ ok: false }`), call
   `setSpanOutcome(AfOutcome.Error, reason, span)`. Use `Skipped`, `Ignored`, `Duplicate`
   or `Retry` for non-error early returns. The reason is redacted.
5. Every error path logs inside the span; the log carries `trace_id` automatically.
6. No behaviour change: same returns, throws and order.
7. Add a `<module>.spans.test.ts` with one happy path (name and ids) and one failure path
   (status ERROR and reason), using `installInMemorySpans()`.

## Log and trace correlation, `af.*` aliases

A log written inside a span carries `trace_id` and `span_id` on both stdout and the OTel
record, so SigNoz links a trace to its logs. Log meta keys that match an id
(`caseId`, `loopId`, `runId`, `workflowRunId`, `orgId`, `projectId`, ...) are also emitted as the `af.*`
attribute (`af.case_id`, ...), so logs and spans filter on the same keys.

## Attributes

`AfAttribute` keys: `af.org_id`, `af.project_id`, `af.case_id`, `af.task_id`, `af.loop_id`,
`af.workflow_run_id`, `af.compute_target_id`, `af.user_id`, `af.auth_method`,
`af.conversation_id`, `af.turn_id`, `af.action_run_id`, `af.connection_id`,
`af.delivery_id`, `af.integration.provider`, `af.command_id`, `af.operation_id`,
`af.cron.job`, `af.outcome`, `af.error.reason`. `AfOutcome`: `ok`, `error`, `skipped`,
`ignored`, `duplicate`, `retry`. The table of meanings is in
[docs/self-hosting.md](../../docs/self-hosting.md#af-attributes).

## Telemetry events and metrics

Operational events keep their category names (`job.started`, `loop.perf.*`,
`db_pool_*`, `request_completed`, ...); they are log records and metrics now, queried in
SigNoz by `body` and attribute. Conventions that still apply:

- Category is `domain.event`; metric names are snake case.
- `count:` fields are increments (Counter), `value:` fields are current readings (Gauge).
- Metric tags use a fixed allowlist (`telemetry/filter-tokens.ts`) to bound cardinality.
- `origin` is one of `desktop`, `api`, `relay`, `mcp`, resolved once at module load from
  `OTEL_SERVICE_NAME` (with or without `af-`); an unknown value becomes `unknown` and logs a
  one-shot `telemetry.origin_fallback` warning.

## Log levels and fields

- Levels:
  - `error`: needs attention. The operation aborts or loses work, a 5xx is returned, or a call failed after
    its retries.
  - `warn`: degraded or recoverable. A fallback after a real failure, a scheduled retry, or a best-effort
    cleanup that left residue.
  - `info`: lifecycle and business outcomes (created, started, completed, failed of Loop, WorkflowRun,
    OrchestratorCase, Task, Turn). Not the reason for a failure.
  - `debug`: expected control flow, failed probes, parse fallbacks, hot-path success.
- Fields on every `warn`/`error`: `reason` (short snake_case cause), the ids in scope (`loopId`,
  `commandId`, `computeTargetId`, `caseId`, `taskId`, `turnId`, `workflowRunId`, `organizationId`,
  `projectId`), and `error` (the caught value; the logger expands and redacts it). Never log bodies,
  prompts, tokens, file contents or URLs with queries. Message names are stable dotted events, for example
  `integration.jira.comment_fetch_failed`.
- No silent `catch`: log, rethrow, return an error value, or make the first line of the body
  `// observability: <why silent>`. Allowed only for parse or validation fallback of optional input,
  probing, best-effort cleanup, telemetry code itself, stream teardown after the peer closed, and a 4xx
  response (captured by `request_completed`).
- Outcome rule:
  - O1: `request_completed` is the single outcome line of every API route.
  - O2: background operations in `withSpan` use the span as outcome record, and every non-ok outcome also
    gets a log line with `reason` and ids.
  - O3: each business lifecycle transition emits exactly one info line named `<entity>.<transition>`.
  - O4: hot paths (health, cron ticks, heartbeats, polling, chunks) log success at debug.
- Use `isLogLevelEnabled(level)` to skip building expensive debug meta.

### Catch audit

`node scripts/observability/catch-audit.mjs` (also run by `pnpm lint`) fails when a `catch` block in server code neither logs, throws, returns a failure value nor starts with `// observability: <why>`. Scope: `apps/api`, `apps/mcp/src`, `apps/app/app/api`, `apps/desktop/src/server`, `apps/desktop/src/headless` and the server packages (storage, email, github, database). Tests and generated code are skipped, as are `catch` tokens inside string and template literals. `CATCH_AUDIT_ROOT` overrides the repo root (used by its test).

## Test setup

`OTEL_SERVICE_NAME` must be set before a test imports `@repo/observability`; the package's
`vitest.setup.ts` sets `api`. Override with `vi.stubEnv("OTEL_SERVICE_NAME", ...)` before
a dynamic import. Use `installInMemorySpans()` to assert spans. Do not assert on log lines.

## See also

- [docs/self-hosting.md](../../docs/self-hosting.md#observability-signoz): stack, dashboards, alerts
- [docs/plan-opentelemetry-signoz.md](../../docs/plan-opentelemetry-signoz.md)
- [packages/telemetry-contract/README.md](../telemetry-contract/README.md)
