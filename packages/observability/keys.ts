import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = () =>
  createEnv({
    emptyStringAsUndefined: true,
    server: {
      OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
      OTEL_SERVICE_NAME: z.string().min(1).optional(),
      OTEL_RESOURCE_ATTRIBUTES: z.string().min(1).optional(),
      OTEL_TRACES_SAMPLER: z.string().min(1).optional(),
      OTEL_TRACES_SAMPLER_ARG: z.string().min(1).optional(),
      OTEL_SDK_DISABLED: z.string().min(1).optional(),
    },
    client: {},
    runtimeEnv: {
      OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
      OTEL_RESOURCE_ATTRIBUTES: process.env.OTEL_RESOURCE_ATTRIBUTES,
      OTEL_TRACES_SAMPLER: process.env.OTEL_TRACES_SAMPLER,
      OTEL_TRACES_SAMPLER_ARG: process.env.OTEL_TRACES_SAMPLER_ARG,
      OTEL_SDK_DISABLED: process.env.OTEL_SDK_DISABLED,
    },
  });
