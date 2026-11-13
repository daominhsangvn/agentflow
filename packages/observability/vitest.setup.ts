// Set OTEL_SERVICE_NAME before any observability module is imported so that
// the module-level ORIGIN constant resolves to a known value in tests.
process.env.OTEL_SERVICE_NAME = "api";
