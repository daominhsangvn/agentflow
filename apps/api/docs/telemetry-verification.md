# Source of truth for TelemetryCategory values: packages/observability/telemetry/schema.ts — update this document when categories are added or removed.

This document is the authoritative verification guide for structured telemetry events in the AgentFlow relay pipeline.

## Contents

- [Prerequisites — SigNoz](#prerequisites--signoz)
- [Local Setup](#local-setup)
- [Trigger Scenarios](#trigger-scenarios)
- [Expected SigNoz Queries](#expected-signoz-queries)
- [Expected Field Values](#expected-field-values)
- [Dependencies and Scope](#dependencies-and-scope)

## Prerequisites — SigNoz

Logs reach SigNoz through the OpenTelemetry log pipeline in `@repo/observability` (OTLP to the SigNoz collector; see `docs/self-hosting.md`, section "Observability (SigNoz)"). For events emitted through `emitter.ts`, `logAtSeverity()` dispatches to `log.error`, `log.warn`, or `log.info` based on the event's `severity`, so the log record's severity reflects that choice. In all three cases the event is emitted as a stringified JSON payload, so the telemetry fields (`category`, `severity`, `schemaVersion`, `trace`, etc.) live inside the log body rather than as top-level log attributes. `origin` is the exception: it is always set as a log attribute, so `origin = "api"` works in the Logs Explorer regardless of emission path.

Open SigNoz → Logs → Explorer and run the queries below in the query builder. For fields inside the stringified body, use a body filter:

```
body CONTAINS "command.queued"
body CONTAINS "command.acknowledged"
body CONTAINS "job.started"
body CONTAINS "electron_update.failed"
body CONTAINS "desktop.shutdown_failed"
body CONTAINS "telemetry.validation_failed"
```

Body filters are slower than attribute filters and cannot group by field, but they confirm events are reaching SigNoz.

## Local Setup

Start the stack with the SigNoz services (see `docs/self-hosting.md`) and set the following in `apps/api/.env.local`:

| Variable | Description | Example |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint of the SigNoz collector | `http://localhost:4318` |
| `OTEL_SERVICE_NAME` | Service name; also resolves `origin` (see [Expected Field Values](#expected-field-values)) | `api` |

The relay service sets `OTEL_SERVICE_NAME=relay`.

## Trigger Scenarios

All five scenarios require the OTLP variables above. Scenario (a) additionally uses `$AGENTFLOW_API_KEY`, an org-issued API key. Scenarios (b), (c), (d), and (e) use `$INTERNAL_API_SECRET`, the relay↔API shared secret from `apps/api/.env.local`. Replace each with the value from your local env.

### (a) API-native command lifecycle

Post a command to the API's `/compute-targets/<id>/commands` route to trigger `command.queued` → `command.dispatched` telemetry (origin: `api`). Both events are emitted from within this API route — `command.queued` from `desktop-command-store.ts` when the command row is created, and `command.dispatched` from the route handler after the relay HTTP call returns. Hitting the relay's `/dispatch` endpoint directly bypasses these emission sites and produces no telemetry.

```sh
curl -X POST http://localhost:3002/compute-targets/<your-compute-target-id>/commands \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENTFLOW_API_KEY" \
  -d '{
    "operationId": "test-op-001",
    "method": "GET",
    "path": "/api/gateway/health-check"
  }'
```

Expected: `command.queued` telemetry is emitted once the DB row is created, followed by `command.dispatched` after the API forwards the envelope to the relay. Both are emitted regardless of whether a desktop worker is connected (the relay-delivered/undelivered distinction is captured in `command.dispatched` meta, not in whether it is emitted).

### (b) Desktop-forwarded telemetry event

Simulate a relay-forwarded `desktop.telemetry` event for `TelemetryCategory.JobStarted = "job.started"`. This hits `handleTelemetryEvent()` in `apps/api/lib/desktop-telemetry-handler.ts`, which sets `origin = Origin.Desktop`:

```sh
curl -X POST http://localhost:3002/internal/relay/socket-event \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{
    "event": "desktop.telemetry",
    "targetId": "<your-compute-target-id>",
    "payload": {
      "schemaVersion": "1",
      "category": "job.started",
      "severity": "info",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "trace": {
        "commandId": "test-cmd-001",
        "operationId": "test-op-001",
        "computeTargetId": "<your-compute-target-id>",
        "gatewaySessionId": "00000000-0000-0000-0000-000000000001",
        "schemaVersion": "1"
      }
    }
  }'
```

Expected: structured log record in SigNoz with `category: "job.started"` and `origin: "desktop"`.

### (c) Desktop update and shutdown failure telemetry

Simulate critical Desktop failure events sent through the existing relay-forwarded `desktop.telemetry` path. These events are intentionally bounded diagnostics only; raw log content is not part of the accepted schema, and unknown raw-log fields are stripped before logging.

```sh
curl -X POST http://localhost:3002/internal/relay/socket-event \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{
    "event": "desktop.telemetry",
    "targetId": "<your-compute-target-id>",
    "payload": {
      "schemaVersion": "1",
      "category": "electron_update.failed",
      "severity": "error",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "trace": {
        "commandId": "",
        "operationId": "desktop-update-test-001",
        "computeTargetId": "<your-compute-target-id>",
        "gatewaySessionId": "00000000-0000-0000-0000-000000000001",
        "schemaVersion": "1"
      },
      "diagnostics": {
        "desktopUpdate": {
          "trigger": "apply-before-downloaded",
          "status": "available",
          "downloaded": false,
          "readyToInstall": false,
          "error": "Update not downloaded"
        }
      }
    }
  }'
```

```sh
curl -X POST http://localhost:3002/internal/relay/socket-event \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{
    "event": "desktop.telemetry",
    "targetId": "<your-compute-target-id>",
    "payload": {
      "schemaVersion": "1",
      "category": "desktop.shutdown_failed",
      "severity": "error",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "trace": {
        "commandId": "",
        "operationId": "desktop-shutdown-test-001",
        "computeTargetId": "<your-compute-target-id>",
        "gatewaySessionId": "00000000-0000-0000-0000-000000000001",
        "schemaVersion": "1"
      },
      "diagnostics": {
        "desktopShutdown": {
          "trigger": "outer-hard-exit",
          "result": "timed_out",
          "phase": "server.stop",
          "duringUpdate": true,
          "outerHardExit": true,
          "elapsedMs": 12000,
          "error": "Shutdown exceeded hard exit timeout"
        }
      }
    }
  }'
```

Expected: each log record has top-level `origin: "desktop"` and top-level `category` set to the submitted category, so `origin = "desktop" AND category = "electron_update.failed"` and `origin = "desktop" AND category = "desktop.shutdown_failed"` resolve as attributes without a body filter. `diagnostics.desktopUpdate` and `diagnostics.desktopShutdown` contain only schema-bounded fields; no raw log upload is accepted.

### (d) Validation failure trigger

Same endpoint as (b), but with an intentionally invalid payload (missing required `schemaVersion` field). This triggers `telemetry.validation_failed`:

```sh
curl -X POST http://localhost:3002/internal/relay/socket-event \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -d '{
    "event": "desktop.telemetry",
    "targetId": "<your-compute-target-id>",
    "payload": {
      "category": "job.started",
      "severity": "info",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "trace": {
        "commandId": "test-cmd-001",
        "operationId": "test-op-001",
        "computeTargetId": "<your-compute-target-id>"
      }
    }
  }'
```

Expected: log entry with `category: "telemetry.validation_failed"` and `issues` array describing the missing `schemaVersion`.

### (e) Connection lifecycle events

Connection lifecycle events require an actual Socket.IO connection from a desktop worker to the relay. They split by origin:

- **Relay-origin** (`connection.socket_accepted`, `connection.reconnecting`, `connection.degraded`, `connection.disconnected`, `connection.stale_heartbeat`) — emitted directly by `apps/relay/src/index.ts` via `log.*(JSON.stringify({ category: ... }))`, bypassing the structured `emitter.ts` pipeline. Origin resolves to `relay` via `OTEL_SERVICE_NAME`. Severity is mixed: `connection.socket_accepted`, `connection.reconnecting`, and `connection.disconnected` use `log.info` and land with severity `INFO`; `connection.stale_heartbeat` and `connection.degraded` use `log.warn` and land with severity `WARN`. Scoping a query to severity `INFO` would silently drop the two degradation signals.
- **API-origin** (`connection.registered`, `connection.resumed`) — emitted from `apps/api/app/internal/relay/socket-event/service.ts` via `emitConnectionStateEvent()` through `emitter.ts`. Origin resolves to `api`.

To trigger them: start the relay (`pnpm turbo dev --filter=relay`) and connect a desktop worker. The relay emits its categories on socket accept, disconnect, heartbeat-stale detection, and reconnect; the API emits its categories when acknowledging the worker's hello.

## Expected SigNoz Queries

Where a field lives depends on the emission path:

- **API-origin and relay-origin events** are emitted via `emitter.ts` (`log.*(JSON.stringify(payload))`) or the relay's direct `log.*(JSON.stringify({ ... }))` calls. `category`, `severity`, `trace`, etc. live inside the stringified log body; filter with `body CONTAINS "<category>"`.
- **Desktop-origin events** are emitted via `handleTelemetryEvent()` using `log.info("message", { meta })`. The meta object is attached as log attributes, so `category` and `origin` are filterable attributes.

`origin` is always an attribute regardless of path.

For desktop target traceability, prefer the attribute `computeTargetId = "<compute-target-id>"` on API/app logs and `trace.computeTargetId = "<compute-target-id>"` on structured telemetry. `targetId` may still appear in relay protocol payloads, path params, and older log rows, but new logs should expose `computeTargetId` as the stable field.

### API-origin events (origin: `api`)

| Query | Category |
|---|---|
| `body CONTAINS "command.queued" AND origin = "api"` | `TelemetryCategory.CommandQueued` — minted in the commands route |
| `body CONTAINS "command.dispatched" AND origin = "api"` | `TelemetryCategory.CommandDispatched` — after relay HTTP call |
| `body CONTAINS "command.acknowledged" AND origin = "api"` | `TelemetryCategory.CommandAcknowledged` — desktop ACK received |
| `body CONTAINS "command.completed" AND origin = "api"` | `TelemetryCategory.CommandCompleted` |
| `body CONTAINS "command.failed" AND origin = "api"` | `TelemetryCategory.CommandFailed` |
| `body CONTAINS "command.timed_out" AND origin = "api"` | `TelemetryCategory.CommandTimedOut` |
| `body CONTAINS "command.replayed" AND origin = "api"` | `TelemetryCategory.CommandReplayed` |
| `body CONTAINS "connection.registered" AND origin = "api"` | `TelemetryCategory.ConnectionRegistered` — emitted from `apps/api/app/internal/relay/socket-event/service.ts` via `emitConnectionStateEvent()` on hello-ACK |
| `body CONTAINS "connection.resumed" AND origin = "api"` | `TelemetryCategory.ConnectionResumed` — emitted from `apps/api/app/internal/relay/socket-event/service.ts` via `emitConnectionStateEvent()` on hello-ACK resume |
| `body CONTAINS "telemetry.validation_failed"` | `TelemetryCategory.TelemetryValidationFailed` — any origin |

### Desktop-origin events (origin: `desktop`)

These arrive via `handleTelemetryEvent()` which sets `origin = Origin.Desktop`. `category` and `origin` are emitted as log attributes (via `log.info("msg", { meta })`), so the queries below resolve directly:

| Query | Category |
|---|---|
| `category = "job.started" AND origin = "desktop"` | `TelemetryCategory.JobStarted` |
| `category = "job.plan_source_resolved" AND origin = "desktop" AND trace.loopId = "<loop-id>"` | `TelemetryCategory.JobPlanSourceResolved` — EXECUTE plan staging source plus safe plan hashes/lengths in `diagnostics.planSource` |
| `category = "job.decision_table_verification" AND origin = "desktop" AND trace.loopId = "<loop-id>"` | `TelemetryCategory.JobDecisionTableVerification` — EXECUTE decision-table verifier status plus safe counters in `diagnostics.decisionTableVerification`; Desktop event prose is exposed as `telemetryMessage` |
| `category = "job.completed" AND origin = "desktop"` | `TelemetryCategory.JobCompleted` |
| `category = "job.failed" AND origin = "desktop"` | `TelemetryCategory.JobFailed` |
| `category = "command.timeout" AND origin = "desktop"` | `TelemetryCategory.CommandTimeout` |
| `category = "command.cancelled" AND origin = "desktop"` | `TelemetryCategory.CommandCancelled` |
| `category = "command.gateway_error" AND origin = "desktop"` | `TelemetryCategory.CommandGatewayError` |
| `category = "preflight.binary_not_found" AND origin = "desktop"` | `TelemetryCategory.PreflightBinaryNotFound` |
| `category = "preflight.script_not_found" AND origin = "desktop"` | `TelemetryCategory.PreflightScriptNotFound` |
| `category = "preflight.spawn_failed" AND origin = "desktop"` | `TelemetryCategory.PreflightSpawnFailed` |
| `category = "electron_update.initiated" AND origin = "desktop"` | `TelemetryCategory.ElectronUpdateInitiated` |
| `category = "electron_update.succeeded" AND origin = "desktop"` | `TelemetryCategory.ElectronUpdateSucceeded` |
| `category = "electron_update.failed" AND origin = "desktop"` | `TelemetryCategory.ElectronUpdateFailed` |
| `category = "desktop.shutdown_failed" AND origin = "desktop"` | `TelemetryCategory.DesktopShutdownFailed` |

Desktop update and shutdown failure diagnostics are logged under `diagnostics.desktopUpdate` and `diagnostics.desktopShutdown` respectively. Accepted fields are bounded and intentionally operational:

| Diagnostic path | Values | Notes |
|---|---|---|
| `diagnostics.desktopUpdate.trigger` | `"updater-error"` \| `"check-for-updates"` \| `"manual-check"` \| `"apply-before-downloaded"` \| `"renderer-apply-update"` \| `"unknown"` | Why Desktop emitted the update telemetry; newer unrecognized trigger strings are normalized to `"unknown"` |
| `diagnostics.desktopUpdate.status` | string up to 64 chars | Current packaged updater status |
| `diagnostics.desktopUpdate.version` | string up to 64 chars | Downloaded or available version when known |
| `diagnostics.desktopUpdate.percent` | number `0..100` | Download progress when known |
| `diagnostics.desktopUpdate.downloaded` | boolean | Whether the package was downloaded before apply |
| `diagnostics.desktopUpdate.readyToInstall` | boolean | Whether the renderer should expose `Update & restart` |
| `diagnostics.desktopUpdate.error` | string up to 512 chars | Sanitized error summary only |
| `diagnostics.desktopShutdown.trigger` | `"before-quit"` \| `"shutdown-sequence"` \| `"shutdown-rejected"` \| `"outer-hard-exit"` \| `"unknown"` | Where shutdown failure was observed; newer unrecognized trigger strings are normalized to `"unknown"` |
| `diagnostics.desktopShutdown.result` | `"timed_out"` \| `"failed"` | Shutdown result classification |
| `diagnostics.desktopShutdown.phase` | string up to 128 chars | Failing shutdown phase |
| `diagnostics.desktopShutdown.duringUpdate` | boolean | Whether failure happened during update apply |
| `diagnostics.desktopShutdown.outerHardExit` | boolean | Whether the outer hard-exit timeout fired |
| `diagnostics.desktopShutdown.elapsedMs` | non-negative integer | Time from shutdown start to failure report |
| `diagnostics.desktopShutdown.error` | string up to 512 chars | Sanitized error summary only |

### Relay connection events (origin: `relay`)

The relay emits the connection lifecycle events below via `log.info(JSON.stringify({ category: ... }))` **directly** — not through `emitter.ts`. This means they appear as raw stringified JSON in the log body and are found with a body filter. The hello-ACK categories (`connection.registered`, `connection.resumed`) are NOT emitted from the relay — they are emitted from `apps/api` when the API acknowledges a worker's hello, and are listed in the [API-origin events table](#api-origin-events-origin-api) above.

| Query | Category |
|---|---|
| `body CONTAINS "connection.socket_accepted" AND origin = "relay"` | `TelemetryCategory.ConnectionSocketAccepted` |
| `body CONTAINS "connection.reconnecting" AND origin = "relay"` | `TelemetryCategory.ConnectionReconnecting` |
| `body CONTAINS "connection.degraded" AND origin = "relay"` | `TelemetryCategory.ConnectionDegraded` — emitted via `log.warn` (severity `WARN`) |
| `body CONTAINS "connection.disconnected" AND origin = "relay"` | `TelemetryCategory.ConnectionDisconnected` |
| `body CONTAINS "connection.stale_heartbeat" AND origin = "relay"` | `TelemetryCategory.ConnectionStaleHeartbeat` — emitted via `log.warn` (severity `WARN`) |

**Note:** All `emitter.ts`-path events call `log.info(JSON.stringify(payload))` through `logAtSeverity()`. The structured fields land in the log body as stringified JSON, so use body filters. The relay-origin connection events above bypass the emitter entirely but follow the same stringified-JSON-in-body pattern.

## Expected Field Values

These fields are set by the logger in `packages/observability/log.ts` and by the telemetry schemas.

### Log record top-level fields

| Field | Value | Source |
|---|---|---|
| `origin` | `"desktop"` \| `"api"` \| `"relay"` \| `"unknown"` | `Origin` const in `packages/observability/telemetry/origin.ts`; resolved from `OTEL_SERVICE_NAME` at module load; `handleTelemetryEvent()` overrides to `Origin.Desktop` for forwarded events |
| `service.name` | Value of `OTEL_SERVICE_NAME` | OTel resource attribute |
| severity | `INFO` \| `WARN` \| `ERROR` | Set by `logAtSeverity()` based on event severity |
| `callerStatus` | Whatever the call site passed as `status` | Present only when a `log.*` call's meta carried its own `status` (usually an HTTP code); relocated so it cannot be read as the log's severity |
| `trace_id` / `span_id` | Active span ids | Added when the log is emitted inside a span; click through from a log to its trace |
| timestamp | ISO 8601 UTC | Set at emit time |

### Telemetry payload fields (inside the log body)

These fields appear inside the stringified log body:

| Field | Values | Notes |
|---|---|---|
| `category` | Any `TelemetryCategory` value | e.g. `"command.queued"`, `"job.started"` |
| `severity` | `"info"` \| `"warn"` \| `"error"` | From `TelemetrySeverity` |
| `schemaVersion` | `"1"` | Required field on all events |
| `trace.commandId` | UUID v7 | Minted by Prisma `@default(uuid(7))` |
| `trace.computeTargetId` | UUID | Identifies the compute node |
| `trace.gatewaySessionId` | UUID | Desktop gateway WebSocket session — never log or expose in client responses |
| `trace.operationId` | string | Relay operation identifier |
| `errorClass` | `"connection"` \| `"protocol"` \| `"approval"` \| `"sandbox"` \| `"execution"` \| `"deployment"` | From `ErrorClass` const in `schema.ts`; present on error events only |

### Origin resolution detail

`ORIGIN` is resolved once at module load in `origin.ts` by matching `OTEL_SERVICE_NAME` against `KNOWN_ORIGINS`. If `OTEL_SERVICE_NAME` is unset or does not match a known origin, `origin` falls back to `"unknown"` and a server-side warning is emitted. Set `OTEL_SERVICE_NAME=api` for the API app and `OTEL_SERVICE_NAME=relay` for the relay.

## Dependencies and Scope

### Production relay verification

Full production-side relay verification (connection lifecycle events from deployed relay instances) is gated on **FEA-441**. Update this section when FEA-441 lands.

### Background work

`apps/api` is a long-lived Node process. Background work, including `log.flush()`, goes through `waitUntil` from `@/lib/wait-until`, which logs a rejection instead of crashing the process. To audit for unguarded flush calls:

```sh
grep -r "log\.flush" apps/api/app --include="*.ts" | grep -v waitUntil
```

## See also

- [packages/observability/README.md](../../../packages/observability/README.md) — modules, `origin` semantics, and cardinality rules
- [apps/api/docs/command-correlation.md](./command-correlation.md) — `commandId` minting, propagation, and correlation context contract
- [`/packages/observability/telemetry/schema.ts`](/packages/observability/telemetry/schema.ts) — canonical `TelemetryCategory` and `TelemetryTraceContext` definitions
- [`/packages/observability/telemetry/emitter.ts`](/packages/observability/telemetry/emitter.ts) — `emitCommandLifecycleEvent()`, `emitConnectionStateEvent()`, and `logAtSeverity()`
- [`/packages/observability/log.ts`](/packages/observability/log.ts) — logger and OTel log bridge
- [`/packages/observability/telemetry/origin.ts`](/packages/observability/telemetry/origin.ts) — `Origin` const and `ORIGIN` module-load resolution
- [`/apps/api/lib/desktop-telemetry-handler.ts`](/apps/api/lib/desktop-telemetry-handler.ts) — `handleTelemetryEvent()` which sets `origin = Origin.Desktop`
- [`/apps/relay/src/index.ts`](/apps/relay/src/index.ts) — relay connection lifecycle event emission and `/dispatch` HTTP handler
