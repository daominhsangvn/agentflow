import { installInMemorySpans } from "@repo/observability/testing/in-memory-spans";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import { sendMail } from "../mail-transport";

const ERROR_STATUS_CODE = 2;

describe("sendMail span", () => {
  const memory = installInMemorySpans();

  beforeAll(() => {
    vi.stubEnv("SMTP_URL", "");
  });
  beforeEach(() => {
    memory.reset();
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    memory.uninstall();
  });

  it("marks email.send as an error when SMTP_URL is unset", async () => {
    await expect(
      sendMail({ to: "a@example.com", subject: "s", text: "t" })
    ).rejects.toThrow("SMTP_URL is not set");

    const span = memory.spans().find((s) => s.name === "email.send");
    expect(span?.status.code).toBe(ERROR_STATUS_CODE);
    expect(span?.attributes["af.outcome"]).toBe("error");
    expect(span?.events[0]?.attributes?.["exception.message"]).toBe(
      "SMTP_URL is not set"
    );
    expect(span?.attributes["af.mail.recipient_count"]).toBe(1);
    expect(JSON.stringify(span?.attributes)).not.toContain("example.com");
  });
});
