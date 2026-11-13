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

Both `docker-compose.yml` and `deploy/compose/docker-compose.prod.yml` start SigNoz by
default and mount this directory read-only.

Setup and operation: [docs/self-hosting.md](../../docs/self-hosting.md#observability-signoz).
