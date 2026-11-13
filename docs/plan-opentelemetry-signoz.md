# Plan: OpenTelemetry + SigNoz

Goal: every operation (HTTP request, background job, orchestrator/loop/workflow step,
outbound integration call, runner command, Claude CLI run) produces correlated traces,
logs and metrics in a self-hosted SigNoz, so a problem can be traced end to end.

## Decisions

- Datadog support is removed. Services only know the standard `OTEL_*` env vars
  (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`,
  `OTEL_TRACES_SAMPLER[_ARG]`). Telemetry is on when an endpoint is set, off otherwise.
- SigNoz runs in the compose profile `observability` (dev `docker-compose.yml` and
  `deploy/compose/docker-compose.prod.yml`), ports bound to `127.0.0.1`.
- Retention: traces and logs 15 days, metrics 30 days.
- Runners send OTLP through an authenticated api proxy (`/otel/v1/{traces,logs,metrics}`,
  runner JWT), not through the relay (the relay is not deployed).
- Telemetry is not an audit log (sampled, time-limited). An audit table is out of scope.
- Telemetry never fails a process: bootstrap errors leave it disabled (fail-open).
- No secrets, tokens, prompt/code content or emails in attributes; `redact.ts` in-process
  and the collector redaction processor as a second layer.

## Target architecture

```
browser ──traceparent──► api ──► postgres / rustfs / github / jira / teams / smtp
                          │ ▲
          command+traceparent  callback+traceparent
                          ▼ │
                 runner (headless) ──► git / claude (TRACEPARENT, OTEL_* env)
api, app, mcp ──OTLP──► signoz-otel-collector ──► clickhouse ──► SigNoz UI
runner ──OTLP via api /otel/v1/* proxy ──┘
```

## Phases

### 0. Infrastructure
SigNoz (ClickHouse, collector, query service, UI) in the `observability` profile.
Collector: `memory_limiter`, `batch`, redaction (from
`packages/telemetry-contract/collector/keyless-telemetry-redaction.yaml`), tail sampling
(keep all error and slow traces). Env examples and `docs/self-hosting.md`.

### 1. `@repo/observability` SDK
- Config reads `OTEL_*`; drop `DD_*`, `ddtags`, the Datadog intake and site allowlist.
- `initTelemetry()`: NodeSDK with traces, logs and metrics; instrumentations `http`,
  `undici`, `pg`, `@prisma/instrumentation`.
- `log.ts`: stdout plus OTel LogRecords carrying `trace_id`/`span_id`.
- `emitTelemetryMetric` / `db_pool_*` become OTel Counters (`count:`) and Gauges (`value:`).
- Helpers `withSpan(name, attrs, fn)`, `recordError`, const `AfAttribute`
  (`af.org_id`, `af.project_id`, `af.case_id`, `af.task_id`, `af.loop_id`,
  `af.workflow_run_id`, `af.compute_target_id`, `af.user_id`).
- Flush on shutdown.

### 2. Per-app wiring
api (`instrumentation.node.ts`, auth wrappers set user/org, every route logs
`request_completed`, `waitUntil()` work runs in linked spans), app (server
`instrumentation.ts`; browser only propagates `traceparent`), mcp (entrypoint init,
span per tool call), runner (desktop OTel runtime exporting via the api proxy).

### 3. Context propagation
`traceparent` in api→runner command envelopes and runner→api callbacks; `TRACEPARENT`
and Claude Code telemetry env (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_*`,
`af.task_id` resource attribute) for spawned CLIs; inbound webhooks start root spans
linked to the case/workflow they trigger.

### 4. Domain spans
`withSpan` at service level: orchestrator (advance, tasks, decisions, teams-ask, waits,
supersede, inbound), loops (dispatch, state transitions, preflight), workflows
(event → match → action), integrations (inbound/outbound delivery, retries),
self-hosted cron jobs, compute-target health/capabilities, catalog/distributions/api-key writes.

### 5. Dashboards, alerts, cleanup
SigNoz dashboards (API RED, orchestrator, loops, runners, DB pool, external calls),
alerts via SMTP or Teams/Slack webhook, remove leftover Datadog code and tests, update
`packages/observability/README.md`, CLAUDE.md and `docs/architecture/`.

## Verification
Unit tests assert on in-memory exporter output (not on console). E2E: with the
`observability` profile up, one Jira ticket → case → runner → Claude → PR flow shows a
single connected trace, and its logs link to that trace.
