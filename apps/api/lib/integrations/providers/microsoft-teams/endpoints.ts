import { log } from "@repo/observability/log";
import { env } from "@/env";

/**
 * Where the Teams provider talks to: Bot Framework OpenID metadata and keys,
 * the Entra token endpoint, the Bot Connector and Microsoft Graph.
 *
 * Dev only: TEAMS_EMULATOR_URL swaps all of them for a local emulator
 * (scripts/dev/teams-emulator.mjs). It is ignored when NODE_ENV is
 * "production", so a production API never trusts a stray value.
 */

export type TeamsEndpoints = {
  openIdUrl: string;
  keysHost: string;
  keysProtocols: ReadonlySet<string>;
  tokenUrl: (tenantId: string) => string;
  isServiceHost: (url: URL) => boolean;
  globalServiceUrl: string;
  graphBaseUrl: string;
  emulated: boolean;
};

export function resolveTeamsEndpoints(
  emulatorUrl: string | undefined,
  nodeEnv: string | undefined
): TeamsEndpoints {
  const origin = emulatorUrl ? URL.parse(emulatorUrl)?.origin : undefined;
  if (!origin || nodeEnv === "production") {
    return PRODUCTION_ENDPOINTS;
  }
  return {
    openIdUrl: `${origin}/botframework/.well-known/openidconfiguration`,
    keysHost: new URL(origin).hostname,
    keysProtocols: new Set(["http:", "https:"]),
    tokenUrl: (tenantId) =>
      `${origin}/entra/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    isServiceHost: (url) => url.origin === origin,
    globalServiceUrl: `${origin}/smba/teams/`,
    graphBaseUrl: `${origin}/graph/v1.0`,
    emulated: true,
  };
}

/** The endpoints of this process, from TEAMS_EMULATOR_URL and NODE_ENV. */
export function teamsEndpoints(): TeamsEndpoints {
  const emulatorUrl = env.TEAMS_EMULATOR_URL;
  const nodeEnv = process.env.NODE_ENV;
  const cacheKey = `${emulatorUrl ?? ""}|${nodeEnv ?? ""}`;
  if (cached?.key !== cacheKey) {
    if (emulatorUrl && nodeEnv === "production") {
      log.warn("TEAMS_EMULATOR_URL is ignored in production");
    }
    cached = {
      key: cacheKey,
      endpoints: resolveTeamsEndpoints(emulatorUrl, nodeEnv),
    };
  }
  return cached.endpoints;
}

let cached: { key: string; endpoints: TeamsEndpoints } | undefined;

/** Commercial cloud (regional paths under one host). */
const SERVICE_HOSTS = new Set(["smba.trafficmanager.net"]);
/** GCC, GCC High and DoD: smba.infra.<cloud>.teams.microsoft.{com,us}. */
const SERVICE_HOST_RE =
  /^smba\.infra\.[a-z0-9-]+\.teams\.microsoft\.(com|us)$/i;

export const BOT_FRAMEWORK_OPENID_URL =
  "https://login.botframework.com/v1/.well-known/openidconfiguration";

const PRODUCTION_ENDPOINTS: TeamsEndpoints = {
  openIdUrl: BOT_FRAMEWORK_OPENID_URL,
  keysHost: "login.botframework.com",
  keysProtocols: new Set(["https:"]),
  tokenUrl: (tenantId) =>
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
  isServiceHost: (url) => {
    const host = url.hostname.toLowerCase();
    return SERVICE_HOSTS.has(host) || SERVICE_HOST_RE.test(host);
  },
  globalServiceUrl: "https://smba.trafficmanager.net/teams/",
  graphBaseUrl: "https://graph.microsoft.com/v1.0",
  emulated: false,
};
