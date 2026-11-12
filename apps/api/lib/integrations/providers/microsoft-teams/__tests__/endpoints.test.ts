import { describe, expect, it, vi } from "vitest";
import { resolveTeamsEndpoints } from "../endpoints";

vi.mock("@/env", () => ({ env: {} }));
vi.mock("@repo/observability/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const EMULATOR = "http://localhost:3990";
const PRODUCTION_GRAPH = "https://graph.microsoft.com/v1.0";

describe("resolveTeamsEndpoints", () => {
  it("uses the production endpoints when unset", () => {
    const endpoints = resolveTeamsEndpoints(undefined, "development");
    expect(endpoints.emulated).toBe(false);
    expect(endpoints.openIdUrl).toBe(
      "https://login.botframework.com/v1/.well-known/openidconfiguration"
    );
    expect(endpoints.keysHost).toBe("login.botframework.com");
    expect([...endpoints.keysProtocols]).toEqual(["https:"]);
    expect(endpoints.tokenUrl("t 1")).toBe(
      "https://login.microsoftonline.com/t%201/oauth2/v2.0/token"
    );
    expect(endpoints.globalServiceUrl).toBe(
      "https://smba.trafficmanager.net/teams/"
    );
    expect(endpoints.graphBaseUrl).toBe(PRODUCTION_GRAPH);
    expect(
      endpoints.isServiceHost(new URL("https://smba.trafficmanager.net/emea"))
    ).toBe(true);
    expect(
      endpoints.isServiceHost(
        new URL("https://smba.infra.gcc.teams.microsoft.com")
      )
    ).toBe(true);
    expect(endpoints.isServiceHost(new URL("https://evil.example"))).toBe(
      false
    );
  });

  it("ignores the emulator in production", () => {
    const endpoints = resolveTeamsEndpoints(EMULATOR, "production");
    expect(endpoints.emulated).toBe(false);
    expect(endpoints.isServiceHost(new URL(`${EMULATOR}/smba/teams/`))).toBe(
      false
    );
    expect(endpoints.graphBaseUrl).toBe(PRODUCTION_GRAPH);
  });

  it("points everything at the emulator outside production", () => {
    const endpoints = resolveTeamsEndpoints(EMULATOR, "development");
    expect(endpoints.emulated).toBe(true);
    expect(endpoints.openIdUrl).toBe(
      `${EMULATOR}/botframework/.well-known/openidconfiguration`
    );
    expect(endpoints.keysHost).toBe("localhost");
    expect(endpoints.keysProtocols.has("http:")).toBe(true);
    expect(endpoints.tokenUrl("tenant")).toBe(
      `${EMULATOR}/entra/tenant/oauth2/v2.0/token`
    );
    expect(endpoints.isServiceHost(new URL(`${EMULATOR}/smba/teams/`))).toBe(
      true
    );
    expect(endpoints.globalServiceUrl).toBe(`${EMULATOR}/smba/teams/`);
    expect(endpoints.graphBaseUrl).toBe(`${EMULATOR}/graph/v1.0`);
  });
});
