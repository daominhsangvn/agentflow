import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import {
  installInMemorySpans,
  TestSpanStatus,
} from "@repo/observability/testing/in-memory-spans";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProviderHttp } from "../http";

const URL_WITH_SECRET = "https://hooks.example.com/secret-token-123";
const PROVIDER = "jira";

function respondWith(status: number): typeof fetch {
  return () => Promise.resolve(new Response("", { status }));
}

describe("integration.http span", () => {
  const memory = installInMemorySpans();

  beforeEach(() => {
    memory.reset();
  });
  afterAll(() => {
    memory.uninstall();
  });

  function httpSpan() {
    return memory.spans().find((span) => span.name === "integration.http");
  }

  it("records a 503 as a retry without an error status", async () => {
    const http = createProviderHttp(respondWith(503), { provider: PROVIDER });

    await http.request({ method: "POST", url: URL_WITH_SECRET });

    const span = httpSpan();
    expect(span?.attributes[AfAttribute.IntegrationProvider]).toBe(PROVIDER);
    expect(span?.attributes["http.request.method"]).toBe("POST");
    expect(span?.attributes["http.response.status_code"]).toBe(503);
    expect(span?.attributes[AfAttribute.Outcome]).toBe(AfOutcome.Retry);
    expect(span?.status.code).not.toBe(TestSpanStatus.Error);
  });

  it("marks a 401 as an error", async () => {
    const http = createProviderHttp(respondWith(401), { provider: PROVIDER });

    await http.request({ method: "GET", url: URL_WITH_SECRET });

    const span = httpSpan();
    expect(span?.status.code).toBe(TestSpanStatus.Error);
    expect(span?.status.message).toBe("HTTP 401");
  });

  it("marks a thrown fetch as an error with the URL replaced", async () => {
    const http = createProviderHttp(
      () => Promise.reject(new Error(`connect failed: ${URL_WITH_SECRET}`)),
      { provider: PROVIDER }
    );

    await http.request({ method: "GET", url: URL_WITH_SECRET });

    const span = httpSpan();
    expect(span?.status.code).toBe(TestSpanStatus.Error);
    expect(span?.status.message).toContain("[url]");
    expect(JSON.stringify(span)).not.toContain("secret-token-123");
  });
});
