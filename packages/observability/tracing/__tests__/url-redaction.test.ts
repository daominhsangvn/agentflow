import { describe, expect, it } from "vitest";
import {
  httpIncomingUrlAttributes,
  httpUrlAttributes,
  redactUrlQuery,
  SENSITIVE_QUERY_PARAMS,
  undiciUrlAttributes,
} from "../url-redaction";

describe("url redaction", () => {
  it("redacts sensitive query values and keeps the rest", () => {
    expect(redactUrlQuery("https://h/p?api-version=1&sig=abc123&sv=2")).toBe(
      "https://h/p?api-version=1&sig=[redacted]&sv=2"
    );
  });

  it("overrides undici url attributes with redacted values", () => {
    const attrs = undiciUrlAttributes({
      origin: "https://prod.logic.azure.com",
      path: "/workflows/x/triggers/manual?sig=SECRET&sp=1",
    });
    expect(attrs["url.full"]).not.toContain("SECRET");
    expect(attrs["url.query"]).toBe("?sig=[redacted]&sp=1");
  });

  it("returns only url.full and url.query for undici", () => {
    const attrs = undiciUrlAttributes({
      origin: "https://h",
      path: "/p?x=1",
    });
    expect(Object.keys(attrs).sort()).toEqual(["url.full", "url.query"]);
  });

  it("returns only url.full for outgoing http requests", () => {
    const attrs = httpUrlAttributes({
      protocol: "https:",
      hostname: "example.com",
      path: "/a?token=SECRET",
    });
    expect(attrs).toEqual({
      "url.full": "https://example.com/a?token=[redacted]",
    });
  });

  it("does not append the port twice when host already has one", () => {
    expect(
      httpUrlAttributes({ host: "h:8080", port: 8080, path: "/x?sig=a" })
    ).toEqual({ "url.full": "http://h:8080/x?sig=[redacted]" });
  });

  it("redacts the incoming query without the leading question mark", () => {
    expect(
      httpIncomingUrlAttributes({ url: "/api/auth/cb?code=abc&token=def&ok=1" })
    ).toEqual({ "url.query": "code=[redacted]&token=[redacted]&ok=1" });
  });

  it("returns no incoming attributes without a query", () => {
    expect(httpIncomingUrlAttributes({ url: "/loops" })).toEqual({});
  });

  it("covers every sensitive query param", () => {
    for (const name of SENSITIVE_QUERY_PARAMS) {
      expect(redactUrlQuery(`https://h/p?${name}=v`)).toBe(
        `https://h/p?${name}=[redacted]`
      );
    }
  });

  it("returns no overrides for an unparseable request", () => {
    expect(undiciUrlAttributes({ origin: "not a url", path: "/x" })).toEqual(
      {}
    );
  });
});
