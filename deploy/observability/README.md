# Observability (SigNoz) configuration

Config files for the optional self-hosted SigNoz stack (ClickHouse, collector,
query service). Nothing here contains secrets.

- `clickhouse/` – single-node ClickHouse server config, cluster and the
  `histogramQuantile` UDF definition.
- `signoz/prometheus.yml` – SigNoz query service metrics remote read config.
- `otel-collector-config.yaml` – OTLP in; redaction, tail sampling, ClickHouse out.

Mounted read-only by the `observability` profile of `docker-compose.yml` and
`deploy/compose/docker-compose.prod.yml`.

Setup and operation: [docs/self-hosting.md](../../docs/self-hosting.md#observability-signoz-optional).
