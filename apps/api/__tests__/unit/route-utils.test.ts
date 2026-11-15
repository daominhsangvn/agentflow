import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  parseBody,
  parseQueryParams,
  parseSequenceCursor,
} from "@/lib/route-utils";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseSequenceCursor", () => {
  it("returns undefined when the raw value is absent", () => {
    expect(parseSequenceCursor(null)).toBeUndefined();
  });

  it("parses a non-negative integer cursor", () => {
    expect(parseSequenceCursor("0")).toBe(0);
    expect(parseSequenceCursor("42")).toBe(42);
  });

  it("rejects negative, fractional, or non-numeric values", () => {
    expect(parseSequenceCursor("-1")).toBeUndefined();
    expect(parseSequenceCursor("3.5")).toBeUndefined();
    expect(parseSequenceCursor("abc")).toBeUndefined();
  });
});

describe("parseBody", () => {
  const testSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  it("returns parsed body for valid data", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ name: "Test", age: 25 }),
      headers: { "Content-Type": "application/json" },
    });

    const result = await parseBody(request, testSchema);
    expect(result.body).toEqual({ name: "Test", age: 25 });
    expect(result.errorResponse).toBeNull();
  });

  it("returns errorResponse for invalid schema", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }), // missing age
      headers: { "Content-Type": "application/json" },
    });

    const result = await parseBody(request, testSchema);
    expect(result.body).toBeNull();
    expect(result.errorResponse).not.toBeNull();

    if (result.errorResponse) {
      expect(result.errorResponse.status).toBe(400);
    }
  });

  it("returns errorResponse for malformed JSON", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "not valid json",
      headers: { "Content-Type": "application/json" },
    });

    const result = await parseBody(request, testSchema);
    expect(result.body).toBeNull();
    expect(result.errorResponse).not.toBeNull();

    if (result.errorResponse) {
      const json = await result.errorResponse.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe("Invalid JSON body");
    }
  });

  it("returns errorResponse when body exceeds maxBytes", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ name: "Oversized", age: 25 }),
      headers: { "Content-Type": "application/json" },
    });

    const result = await parseBody(request, testSchema, { maxBytes: 8 });
    expect(result.body).toBeNull();
    expect(result.errorResponse).not.toBeNull();

    if (result.errorResponse) {
      const json = await result.errorResponse.json();
      expect(result.errorResponse.status).toBe(413);
      expect(json.success).toBe(false);
      expect(json.error).toBe("Request body too large");
    }
  });
});

describe("parseQueryParams", () => {
  it("preserves repeated query parameters as arrays", () => {
    const url = new URL("http://localhost?targetIds=a&targetIds=b&mode=direct");
    const result = parseQueryParams(
      { nextUrl: { searchParams: url.searchParams } },
      z.object({
        targetIds: z.array(z.string()),
        mode: z.string(),
      })
    );

    expect(result.errorResponse).toBeNull();
    expect(result.params).toEqual({
      targetIds: ["a", "b"],
      mode: "direct",
    });
  });
});
