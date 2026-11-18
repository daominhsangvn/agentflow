import { keys as ai } from "@repo/ai/keys";
import { keys as analytics } from "@repo/analytics/keys";
import { claudeCodeVersionSchema } from "@repo/api/src/types/compute-target-model-provider";
import { keys as auth } from "@repo/auth/keys";
import { keys as collaboration } from "@repo/collaboration/server/keys";
import { keys as database } from "@repo/database/keys";
import { keys as email } from "@repo/email/keys";
import { keys as google } from "@repo/google/keys";
import { keys as linear } from "@repo/linear/keys";
import { keys as core } from "@repo/next-config/keys";
import { keys as observability } from "@repo/observability/keys";
import { keys as pensero } from "@repo/pensero/keys";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import {
  hasStrongLocalGatewayJwtSecret,
  LOCAL_GATEWAY_JWT_MIN_SECRET_LENGTH,
  LOCAL_GATEWAY_JWT_MIN_UNIQUE_SECRET_CHARS,
} from "@/lib/auth/local-gateway-jwt-config";

// Note: @repo/github and @repo/storage keys are validated at runtime (not build time)
// because they're optional integrations. See isGitHubConfigured() / isS3Configured().
// @repo/linear keys are now optional and extended here.

export const env = createEnv({
  emptyStringAsUndefined: true,
  extends: [
    ai(),
    auth(),
    analytics(),
    collaboration(),
    core(),
    database(),
    email(),
    google(),
    linear(),
    observability(),
    pensero(),
  ],
  server: {
    /** The MCP endpoint runners hand to agents for integration tools. */
    AGENTFLOW_MCP_URL: z.url().optional(),
    INTERNAL_API_SECRET: z.string().min(1).optional(),
    LOCAL_GATEWAY_JWT_SECRET: z
      .string()
      .min(LOCAL_GATEWAY_JWT_MIN_SECRET_LENGTH)
      .refine(hasStrongLocalGatewayJwtSecret, {
        message: `LOCAL_GATEWAY_JWT_SECRET must include at least ${LOCAL_GATEWAY_JWT_MIN_UNIQUE_SECRET_CHARS} unique characters`,
      })
      .optional(),
    RELAY_API_URL: z.url().optional(),
    SLACK_BOT_TOKEN: z.string().optional(),
    SLACK_SIGNING_SECRET: z.string().optional(),
    /**
     * Dev only: local Teams emulator (scripts/dev/teams-emulator.mjs). Ignored in
     * production. Never set in prod.
     */
    TEAMS_EMULATOR_URL: z.url().optional(),
    /**
     * Opt-in: path to a Claude Code style settings.json for the platform agent (headless
     * Claude Code runs; first consumer: the workflow builder assistant). Its `env` block is
     * passed to Claude Code. Unset keeps the agent off.
     */
    PLATFORM_AGENT_SETTINGS_FILE: z.string().min(1).optional(),
    /**
     * `latest` or an exact release such as 2.1.322. Exact pins must be installed; the api
     * never installs Claude Code at runtime.
     */
    PLATFORM_AGENT_CLAUDE_CODE_VERSION: claudeCodeVersionSchema.optional(),
    /** Explicit claude binary; default: first `claude` on PATH. */
    PLATFORM_AGENT_CLAUDE_CODE_PATH: z.string().min(1).optional(),
  },
  client: {},
  runtimeEnv: {
    AGENTFLOW_MCP_URL: process.env.AGENTFLOW_MCP_URL,
    INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
    LOCAL_GATEWAY_JWT_SECRET: process.env.LOCAL_GATEWAY_JWT_SECRET,
    RELAY_API_URL: process.env.RELAY_API_URL,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    TEAMS_EMULATOR_URL: process.env.TEAMS_EMULATOR_URL,
    PLATFORM_AGENT_SETTINGS_FILE: process.env.PLATFORM_AGENT_SETTINGS_FILE,
    PLATFORM_AGENT_CLAUDE_CODE_VERSION:
      process.env.PLATFORM_AGENT_CLAUDE_CODE_VERSION,
    PLATFORM_AGENT_CLAUDE_CODE_PATH:
      process.env.PLATFORM_AGENT_CLAUDE_CODE_PATH,
  },
});
