import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import { exportJWK, generateKeyPair, type KeyLike, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundRequest, ProviderHttpRequest } from "../../../types";
import {
  BOT_FRAMEWORK_ISSUER,
  clearBotFrameworkKeyCache,
  verifyTeamsRequest,
} from "../bot-auth";
import { checkServiceUrl } from "../bot-connector";
import { acquireEntraToken, clearEntraTokenCache } from "../entra-token";
import { getRootMessage } from "../graph-client";
import {
  BOT_APP_ID,
  BOT_TENANT_ID,
  jsonResponse,
  routedHttp,
} from "./teams.test-helpers";

const mockEnv = vi.hoisted(() => ({
  env: { TEAMS_EMULATOR_URL: undefined as string | undefined },
}));
vi.mock("@/env", () => mockEnv);
vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const EMULATOR = "http://localhost:3990";
const SERVICE_URL = `${EMULATOR}/smba/teams/`;
const NOW = new Date("2026-10-04T12:00:00.000Z");

let privateKey: KeyLike;
let publicJwk: Record<string, unknown>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "emulator-key" };
});

beforeEach(() => {
  mockEnv.env.TEAMS_EMULATOR_URL = EMULATOR;
  vi.stubEnv("NODE_ENV", "development");
  clearBotFrameworkKeyCache();
  clearEntraTokenCache();
});

function signedRequest(token: string): InboundRequest {
  return {
    rawBody: JSON.stringify({
      type: "message",
      channelId: "msteams",
      serviceUrl: SERVICE_URL,
    }),
    headers: new Headers({ authorization: `Bearer ${token}` }),
    url: new URL("https://api.example.com/webhooks/integrations/key"),
  };
}

function verifyContext(http: ReturnType<typeof routedHttp>["http"]) {
  return {
    connection: {
      id: "connection-1",
      provider: IntegrationProviderKey.MicrosoftTeams,
      name: "Teams",
      config: { appId: BOT_APP_ID, tenantId: BOT_TENANT_ID },
      account: null,
    },
    inboundSecret: "unused",
    http,
    now: () => NOW,
  };
}

async function emulatorToken() {
  return await new SignJWT({
    iss: BOT_FRAMEWORK_ISSUER,
    aud: BOT_APP_ID,
    serviceurl: SERVICE_URL,
  })
    .setProtectedHeader({ alg: "RS256", kid: "emulator-key" })
    .setIssuedAt(Math.floor(NOW.getTime() / 1000) - 60)
    .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 3600)
    .sign(privateKey);
}

describe("Teams endpoints with TEAMS_EMULATOR_URL", () => {
  it("verifies a token signed by the emulator key fetched over http", async () => {
    const { http, requests } = routedHttp((request: ProviderHttpRequest) => {
      if (
        request.url ===
        `${EMULATOR}/botframework/.well-known/openidconfiguration`
      ) {
        return jsonResponse({ jwks_uri: `${EMULATOR}/botframework/keys` });
      }
      if (request.url === `${EMULATOR}/botframework/keys`) {
        return jsonResponse({
          keys: [{ ...publicJwk, endorsements: ["msteams"] }],
        });
      }
      return undefined;
    });

    const result = await verifyTeamsRequest(
      signedRequest(await emulatorToken()),
      verifyContext(http)
    );

    expect(result).toEqual({ ok: true });
    expect(requests.map((request) => request.url)).toEqual([
      `${EMULATOR}/botframework/.well-known/openidconfiguration`,
      `${EMULATOR}/botframework/keys`,
    ]);
  });

  it("requests the Entra token from the emulator", async () => {
    const { http, requests } = routedHttp((request) =>
      request.url.startsWith(`${EMULATOR}/entra/`)
        ? jsonResponse({ access_token: "t", expires_in: 3600 })
        : undefined
    );

    const result = await acquireEntraToken(
      http,
      { appId: BOT_APP_ID, tenantId: BOT_TENANT_ID, clientSecret: "s" },
      "https://api.botframework.com/.default",
      NOW
    );

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe(
      `${EMULATOR}/entra/${BOT_TENANT_ID}/oauth2/v2.0/token`
    );
  });

  it("accepts the emulator's service URL only when emulated", () => {
    expect(checkServiceUrl("http://localhost:3990/smba/teams/")?.origin).toBe(
      EMULATOR
    );
    mockEnv.env.TEAMS_EMULATOR_URL = undefined;
    expect(checkServiceUrl("http://localhost:3990/smba/teams/")).toBeNull();
  });

  it("reads Graph from the emulator", async () => {
    const { http, requests } = routedHttp(() => jsonResponse({ id: "1" }));

    await getRootMessage(http, "token", {
      teamId: "team",
      channelId: "19:a@thread.tacv2",
      rootMessageId: "1",
      messageId: "1",
    });

    expect(
      requests[0]?.url.startsWith(`${EMULATOR}/graph/v1.0/teams/team/`)
    ).toBe(true);
  });

  it("stays on production endpoints in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(checkServiceUrl("http://localhost:3990/smba/teams/")).toBeNull();
    const { http, requests } = routedHttp(() => jsonResponse({ id: "1" }));

    await getRootMessage(http, "token", {
      teamId: "team",
      channelId: "19:a@thread.tacv2",
      rootMessageId: "1",
      messageId: "1",
    });

    expect(
      requests[0]?.url.startsWith("https://graph.microsoft.com/v1.0/")
    ).toBe(true);
  });
});
