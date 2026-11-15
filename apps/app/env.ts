import { keys as analytics } from "@repo/analytics/keys";
import { keys as auth } from "@repo/auth/keys";
import { keys as collaboration } from "@repo/collaboration/server/keys";
import { keys as email } from "@repo/email/keys";
import { clientKeys as github } from "@repo/github/keys";
import { keys as google } from "@repo/google/keys";
import { keys as linear } from "@repo/linear/keys";
import { keys as core } from "@repo/next-config/keys";
import { keys as observability } from "@repo/observability/keys";
import { keys as security } from "@repo/security/keys";
import { keys as webhooks } from "@repo/webhooks/keys";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  extends: [
    auth(),
    analytics(),
    collaboration(),
    core(),
    email(),
    github(),
    google(),
    linear(),
    observability(),
    security(),
    webhooks(),
  ],
  server: {
    INTERNAL_API_SECRET: z.string().min(1).optional(),
    SERVER_API_URL: z.string().url().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_ENVIRONMENT: z
      .enum(["production", "stage", "development"])
      .optional(),
    NEXT_PUBLIC_MCP_SERVER_URL: z.string().url().optional(),
  },
  runtimeEnv: {
    INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
    NEXT_PUBLIC_APP_ENVIRONMENT: process.env.NEXT_PUBLIC_APP_ENVIRONMENT,
    NEXT_PUBLIC_MCP_SERVER_URL: process.env.NEXT_PUBLIC_MCP_SERVER_URL,
    SERVER_API_URL: process.env.SERVER_API_URL,
  },
});
