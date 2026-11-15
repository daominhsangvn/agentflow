# Observability (SigNoz) configuration

Config files for the self-hosted SigNoz stack (ClickHouse, collector,
query service). Nothing here contains secrets.

- `clickhouse/` – single-node ClickHouse server config, cluster and the
  `histogramQuantile` UDF definition.
- `signoz/prometheus.yml` – SigNoz query service metrics remote read config.
- `signoz-init/` – one-shot job (`signoz-init.mjs`) that creates the SigNoz admin and
  provisions channels, dashboards and alert rules; idempotent.
- `dashboards/` – dashboard JSON, one file per dashboard (matched by `title`).
- `alerts/` – alert rule JSON, one file per rule (matched by `alert`).
- `otel-collector-config.yaml` – OTLP in; redaction, tail sampling, ClickHouse out.

Claude Code events (service `af-claude-code`: `api_error`, `tool_result`, `api_request`) carry the
case, loop and run ids as resource attributes. They appear in the Journeys dashboard "Claude Code" panel
(errors first, with the failure reason) and in Logs. The collector raises `api_error` to ERROR and a
`tool_result` with `success=false` to WARN. Tokens and cost per case are in the "Claude Code tokens / cost
per case" panel.

The prod compose (`deploy/compose/docker-compose.prod.yml`) starts SigNoz by default; the dev
`docker-compose.yml` starts it with `--profile observability`. Both mount this directory read-only.

Setup and operation: [docs/self-hosting.md](../../docs/self-hosting.md#observability-signoz).
