# Self-hosting

This edition runs without AWS, Vercel, or any hosted AgentFlow service. Every
backing service starts from `docker-compose.yml`, and Claude Code runs through
the locally installed `claude` CLI (your subscription login, or any
Anthropic-compatible endpoint configured in `~/.claude/settings.json`).

## Quick start

```bash
pnpm install
cp .env.docker.example .env        # optional: change host ports / credentials
docker compose up -d               # Postgres, RustFS (S3), Mailpit, Local Git
pnpm storage:init                  # create the buckets + browser CORS (idempotent)
pnpm local-git:init                # optional: Local Git account + token, written to apps/api/.env.local
cd packages/database && pnpm prisma migrate deploy && cd ../..
pnpm dev
```

| Service  | Image                  | Default host ports            | Purpose |
|----------|------------------------|-------------------------------|---------|
| postgres | `postgres:16`          | 5432                          | Application database |
| rustfs   | `rustfs/rustfs:1.0.1`  | 9000 (S3 API), 9001 (console) | Attachments, transcripts, loop state, catalog assets |
| mailpit  | `axllent/mailpit:v1.27`| 1025 (SMTP), 8025 (web UI)    | Captures outgoing mail in development |
| local-git | `gitea/gitea:1.24.7`  | 3300 (web UI + git over HTTP) | Local Git: repositories on this machine for projects without a remote ([local-git.md](local-git.md)) |

`apps/api/.env.example` lists every variable. The ones specific to
self-hosting:

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Plain PostgreSQL URL. Add `?sslmode=disable` when the host is not `localhost` and the server has no TLS (e.g. inside the compose network). |
| `S3_ENDPOINT` / `S3_PUBLIC_ENDPOINT` | Endpoint used by the API, and the one baked into presigned URLs (must be reachable from browsers, the desktop app and runners; a runner container reaches a local RustFS at `http://host.docker.internal:9000`, which a Windows/macOS browser resolves too). |
| `S3_CORS_ALLOWED_ORIGINS` | Comma-separated web app origins `pnpm storage:init` allows on the attachments (GET/HEAD/PUT) and transcripts (GET/HEAD) buckets; defaults to the origin of `NEXT_PUBLIC_APP_URL`. Without these rules the browser cannot upload attachments or show a session's transcript (Trace). Re-run `storage:init` after changing the app's origin. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Same pair as the RustFS root credentials in `.env`. |
| `S3_MULTIPART_CHECKSUM` | `computed` (default) works on any S3-compatible server; `native` only for AWS S3. |
| `S3_COLD_STORAGE_CLASS` | Leave unset unless the backend supports the class. |
| `ENCRYPTION_KEY` | 32-byte base64 master key for secrets at rest. Rotating it makes stored Claude API keys and integration tokens unreadable. |

## Production (Docker Compose)

`deploy/compose/docker-compose.prod.yml` builds api, app and mcp from source and runs postgres, rustfs, an optional
local-git (profile), plus the one-shot migrate and storage-init jobs. Published ports are bound to 127.0.0.1 for an
existing reverse proxy. Configure it in `deploy/compose/.env`, copied from `.env.prod.example`. `NEXT_PUBLIC_*` values
are build args of the app and api images. Start it with
`docker compose -f deploy/compose/docker-compose.prod.yml up -d --build` (Compose reads `deploy/compose/.env` from the compose file's directory).
Besides `migrate` and `storage-init`, the stack runs `bootstrap-admin` (creates the first AgentFlow owner from
`AGENTFLOW_ADMIN_*` when no user exists; `app` waits for it, but the api accepts sign-up once healthy, so set `AUTH_ALLOW_SIGN_UP=false` for the first `up`) and, with the `local-git` profile, `local-git-init`
(Gitea admin plus the API token the api reads through `LOCAL_GIT_TOKEN_FILE`). The `mailpit` profile adds a mail
catcher. Every account is set in `deploy/compose/.env`.
Full guide: `apps/web/content/docs/guides/setup/production-server.mdx`.

## Authentication

Accounts are local email/password accounts managed by
[Better Auth](https://better-auth.com) inside `apps/api`
(`lib/auth/better-auth.ts`), stored in the `auth_*` tables. The web app serves
the endpoints on its own origin by rewriting `/api/auth/*` to the API, so the
session cookie is first-party. Server code and the browser exchange that cookie
for a 15-minute EdDSA JWT (`/api/auth/token`) carrying the user and the active
organization (`org_id`, `org_slug`, `org_role`); the API verifies it against
`/api/auth/jwks`. `@repo/auth` exposes the same `auth()`, middleware and client
hooks the app used with Clerk.

Single-tenant by default:

- The first account creates the organization (`AUTH_DEFAULT_ORGANIZATION_NAME`
  / `_SLUG`, default `AgentFlow` / `agentflow`) and becomes its owner.
- Later accounts join it as members (`AUTH_AUTO_JOIN_DEFAULT_ORGANIZATION=false`
  to stop that), unless an invitation for their email assigns another role.
- Owners and admins invite people from Settings → Organization; the email links
  to sign-up with the address pre-filled. With `AUTH_ALLOW_SIGN_UP=false` the
  deployment is invite-only: only emails with a pending invitation can sign up.
- More organizations: `AUTH_ALLOW_CREATE_ORGANIZATION=true`.

Password resets and invitations are sent over `SMTP_URL` (Mailpit at
http://localhost:8025 in development). Microsoft Entra ID sign-in is not
configured yet.

## Claude Code plugins

The AgentFlow plugins (`code`, `code-review`, `judges`, `platform`,
`self-learning`, `bootstrap`) are vendored in `agent-plugins/` (Apache-2.0, see
`agent-plugins/NOTICE`). The desktop runner passes them to every `claude`
invocation with `--plugin-dir`, and exports `AGENTFLOW_PLUGIN_DIRS` so
`run-loop.sh` does the same. Nothing is installed into `~/.claude/plugins`.
Set `AGENTFLOW_PLUGINS_DIR` to point the desktop at a different copy.

## Workflows and integrations

Jira, Azure DevOps, Microsoft Teams and generic HTTPS webhooks are connected
under Connections (sidebar), and **Workflows**
(sidebar) turn their events into agent-team runs with optional post actions
(comment back on the ticket, transition it, post to Teams, call a URL). See
[workflows.md](workflows.md) for the architecture and per-provider setup.

The API process runs a small in-process scheduler (`apps/api/lib/self-hosted-cron.ts`)
that calls `/cron/workflows` every `WORKFLOW_TICK_SECONDS` (default 10),
`/cron/timeout-loops` every 5 minutes, and `/cron/reconcile-stale-sessions`
hourly (ends agent sessions still marked active after their machine stopped
reporting for `STALE_SESSION_AGE_HOURS`, default 24), because self-hosted has
no Vercel cron. Set `SELF_HOSTED_CRON_DISABLED=true` if an external scheduler calls the
cron routes instead (then `CRON_SECRET` must be set).

Jira Cloud and Azure DevOps webhooks must reach the API over public HTTPS
(`PUBLIC_WEBHOOK_BASE_URL`). On a machine without a public URL, set the
connection to **poll** mode instead.

## Document collaboration (optional)

Live co-editing, presence and inline comment threads in the document editors
(PRDs, issues, plans) use Liveblocks, which is a hosted service. Leave
`LIVEBLOCKS_SECRET` unset to run without it: `GET /collaboration/status`
answers `{ enabled: false }`, the editors then show the saved version and
**Publish** saves each edit as a new version through the API, and the app
never asks for a room token. Set the secret in `apps/api/.env.local` to turn
the live features on.

## Compute targets: desktop app or headless runner

Loops run on compute targets. Developers can use the desktop app; for
unattended workflow runs, deploy one or more **headless runners** (Docker
image or a systemd service on Ubuntu/Debian): see [runner.md](runner.md).
Workflows and the desktop app talk to compute targets through the desktop
gateway socket hosted by `apps/api/server.ts`.

Runner telemetry (`AGENTFLOW_RUNNER_TELEMETRY=true`, see Observability) starts
asynchronously with the runner. Log records emitted before that OTel runtime
finishes starting are dropped and never exported.

## Feature flags without PostHog

Features still being rolled out sit behind PostHog flags, which are all off
on a deployment without PostHog. Turn them on (or off) for the whole
deployment with comma- or space-separated flag keys; `-key` forces one off,
and an override wins over PostHog:

```bash
# apps/api/.env.local — server-side checks (API routes, ingest)
AGENTFLOW_FEATURE_FLAGS=desktop-agent-session-sync,emergent
# apps/app/.env.local — the web app's UI
NEXT_PUBLIC_AGENTFLOW_FEATURE_FLAGS=desktop-agent-session-sync,emergent
```

The Sessions and Agents pages need no flag or setting: desktops and headless
runners always report their agent sessions and components, and the data stays
in this deployment's database. `desktop-agent-session-sync` now only opens the
Dashboard's insight metrics and golden candidates; `emergent` turns on the
live Active Runs view of Sessions.

## What changed from the hosted product

| Hosted | Self-hosted |
|--------|-------------|
| AWS S3 | RustFS through `@repo/storage` |
| AWS KMS | AES-256-GCM (`apps/api/lib/secret-encryption.ts`) |
| AWS ECS cloud runner | Removed — loops run on desktop compute targets only |
| RDS IAM auth / Neon | `DATABASE_URL` |
| `@vercel/functions` `waitUntil` | `apps/api/lib/wait-until.ts` |
| Vercel preview schemas (`/preview-schemas/ensure`) | Removed |
| `/plugin install` of claude-plugins | `agent-plugins/` + `--plugin-dir` |
| Clerk (auth, organizations, webhooks) | Better Auth in `apps/api` + `@repo/auth` facade |
| Datadog (logs, APM) | OpenTelemetry → self-hosted SigNoz (default stack) |

Still to port: Microsoft Entra ID sign-in, Liveblocks → Hocuspocus, Linear →
disabled.

## Observability (SigNoz)

SigNoz is part of the default stack, in both `docker-compose.yml` and
`deploy/compose/docker-compose.prod.yml`: ClickHouse, ZooKeeper, the schema migrators,
`signoz` (UI and query service), `signoz-otel-collector` and the one-shot `signoz-init`.
Config files are in `deploy/observability/` (mounted read-only). Every published port is
bound to `127.0.0.1`.

```bash
# development (UI http://localhost:8080, OTLP http on :4318)
docker compose up -d
# development without SigNoz (opt-out: name the services you want)
docker compose up -d postgres rustfs mailpit local-git
# production
docker compose -f deploy/compose/docker-compose.prod.yml up -d --build
```

On a server, reach the UI through an SSH tunnel (`ssh -L 8080:127.0.0.1:8080 host`)
or your HTTPS reverse proxy.

### Admin account, JWT secret and `signoz-init`

| Variable | Purpose |
|---|---|
| `SIGNOZ_ADMIN_EMAIL` | SigNoz admin email (dev default `admin@agentflow.local`; required in prod) |
| `SIGNOZ_ADMIN_PASSWORD` | Admin password, at least 8 characters with upper, lower, digit and symbol. In dev, empty skips provisioning; required in prod |
| `SIGNOZ_ADMIN_NAME`, `SIGNOZ_ORG_NAME` | Display name and org (`Admin`, `AgentFlow`) |
| `SIGNOZ_JWT_SECRET` | Signs SigNoz sessions. Dev has a fixed default; prod requires one (`openssl rand -hex 32`). Keep it stable: changing it logs everyone out |
| `SIGNOZ_ALERT_EMAIL_TO`, `SIGNOZ_ALERT_WEBHOOK_URL` | Alert channels (below) |
| `SIGNOZ_SMTP_SMARTHOST`, `_FROM`, `_USERNAME`, `_PASSWORD`, `_REQUIRE_TLS` | SMTP for alert email (dev default: Mailpit) |
| `SIGNOZ_PORT`, `OTEL_GRPC_PORT`, `OTEL_HTTP_PORT` | Host ports (8080, 4317, 4318) |

`signoz-init` waits for SigNoz health, creates the admin through the register endpoint
(a second run reports "already initialised"), logs in, then upserts the notification
channels, dashboards and alert rules by title, so it is idempotent. A password that
differs from the existing admin's fails with "admin login failed". It never prints
secrets. Re-run it after editing `deploy/observability/dashboards/` or `alerts/`:

```bash
docker compose run --rm signoz-init
# production
docker compose -f deploy/compose/docker-compose.prod.yml run --rm signoz-init
```

### Dashboards and alerts

Eight dashboards (`deploy/observability/dashboards/`): API, Orchestrator, Loops, Runners,
DB pool, External calls, Workflows & integrations, and Journeys. Six alert rules
(`deploy/observability/alerts/`): API 5xx rate, API telemetry silent, loop failures,
collector export failures, runner offline, stuck case or workflow run. Alerts go to the
channels that are configured: `af-email` when `SIGNOZ_ALERT_EMAIL_TO` is set, `af-webhook`
(Slack, Teams or any webhook) when `SIGNOZ_ALERT_WEBHOOK_URL` is set.

### Sending telemetry

Apps export with the standard OpenTelemetry variables (compose already sets them):

- `OTEL_EXPORTER_OTLP_ENDPOINT`: on/off switch. Unset means no export
  (`http://localhost:4318` from the host, `http://signoz-otel-collector:4318` in compose).
- `OTEL_SERVICE_NAME` (`af-api`, `af-app`, `af-mcp`, `af-runner`), `OTEL_RESOURCE_ATTRIBUTES`
  (`deployment.environment.name=production`).
- `OTEL_TRACES_SAMPLER_ARG`: head sampling ratio, default `1`.
- `OTEL_SDK_DISABLED=true`: off even when an endpoint is set.
- `LOG_FORMAT=json|pretty`: stdout format. Default is JSON in production.

Known gap: with browser RUM removed, client render errors (`apps/app` `error.tsx` and
`global-error.tsx`) only reach the browser console; they are not in SigNoz.

Telemetry is fail-open: a missing or unreachable collector never breaks a request or
stops an app from starting. The browser sends only a `traceparent` header. The api and mcp
flush pending telemetry within 5 s of shutdown; the app may lose its last batch because
Next's own SIGTERM handler exits first. `apps/api/server.ts` logs `request_completed`
once per request.

Redaction has two layers: `packages/observability/redact.ts` in process (sensitive keys,
secret-shaped and email values) and the collector's `redaction` processor, which repeats
the key and value patterns. Tail sampling in the collector keeps every trace with an
error status, an HTTP 5xx or a duration over 2 s, and a baseline share of the rest
(`TAIL_SAMPLING_BASELINE_PERCENT`, 100 in dev, 25 in production). Span metrics are
computed before sampling, so RED metrics count every span.

Retention is not set by `signoz-init`. In the SigNoz UI open Settings > General and set
traces and logs to 15 days and metrics to 30 days.

### Runner telemetry and Claude Code forwarding

Runner telemetry is opt-in (default off). With `AGENTFLOW_RUNNER_TELEMETRY=true` the
runner exports traces, logs and metrics (service `af-runner`) through
`POST /otel/v1/{traces,logs,metrics}` on the api: API key, protobuf only, 512 KiB per
request, rate limited. The api forwards only to its own `OTEL_EXPORTER_OTLP_ENDPOINT`
and answers 404 when that is unset, so runners never need the collector.

For loops the gateway hands the spawned Claude Code the current trace: `TRACEPARENT` and
`af.loop_id` in `OTEL_RESOURCE_ATTRIBUTES`. When the runner's local OTLP receiver
(127.0.0.1) is ready, Claude Code is also started with `CLAUDE_CODE_ENABLE_TELEMETRY=1`
and OTLP `http/protobuf` metrics and logs pointed at that receiver, which forwards them
through the api proxy. If the receiver is unavailable the env is skipped and the loop
runs normally.

### Find a journey and its reason

1. Open SigNoz and the dashboard "AgentFlow — Journeys".
2. Paste the case id, loop id or workflow run id into the matching variable.
3. The Failures panel lists spans with `status_message` and `af.error.reason`: the
   redacted reason a step failed.
4. Click a `trace_id` to open the trace view: the path across api, app, mcp and runner
   (inbound webhook, workflow, orchestrator, loop, runner command).
5. In the trace view, open the Logs tab for the log lines written inside those spans.

Without the dashboard, use Traces Explorer or Logs Explorer and filter on the attribute,
for example `af.loop_id = <id>` or `af.case_id = <id>`, then add `af.outcome = error` or
`hasError = true`. Logs carry the same `af.*` keys (aliased from `caseId`, `loopId`, ...)
plus `trace_id`.

### `af.*` attributes

| Attribute | Meaning |
|---|---|
| `af.org_id`, `af.project_id`, `af.user_id`, `af.auth_method` | Tenant, project and caller |
| `af.case_id`, `af.task_id` | Case and orchestrator task |
| `af.conversation_id`, `af.turn_id` | Orchestrator conversation and turn |
| `af.loop_id`, `af.command_id`, `af.operation_id` | Loop, runner command, gateway operation |
| `af.workflow_run_id`, `af.action_run_id` | Workflow run and its action run |
| `af.compute_target_id` | Runner (compute target) |
| `af.connection_id`, `af.delivery_id`, `af.integration.provider` | Integration connection, webhook delivery, provider |
| `af.cron.job` | Self-hosted cron job name |
| `af.outcome` | `ok`, `error`, `skipped`, `ignored`, `duplicate`, `retry` |
| `af.error.reason` | Redacted failure reason, set with `setSpanOutcome(AfOutcome.Error, reason)` |

Defined in `packages/observability/af-attributes.ts`; how to add spans is in
[packages/observability/README.md](../packages/observability/README.md).

Datadog is no longer supported; the former `DD_*` variables are ignored.

## Known limitations

- The desktop app is still built for macOS; Linux works in dev mode. Several
  desktop and database tests assume POSIX paths and fail on Windows.
- `apps/desktop` build info needs a git commit (`scripts/write-build-info.mjs`
  runs `git rev-parse HEAD`).
