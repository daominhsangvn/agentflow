import type { LoopRunnerClaims } from "@repo/auth/loop-runner-jwt";
import { AfAttribute } from "@repo/observability/span";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  annotateAuthSpan,
  annotateLoopRunnerSpan,
} from "../auth-span-attributes";
import type { AuthContext } from "../with-auth";

const { setActiveSpanAttributes } = vi.hoisted(() => ({
  setActiveSpanAttributes: vi.fn(),
}));

vi.mock("@repo/observability/span", async (importActual) => ({
  ...(await importActual<typeof import("@repo/observability/span")>()),
  setActiveSpanAttributes,
}));

describe("auth span attributes", () => {
  beforeEach(() => {
    setActiveSpanAttributes.mockClear();
  });

  it("annotates a session context", () => {
    annotateAuthSpan({
      user: { id: "user-1", organizationId: "org-1" },
      authMethod: "session",
    } as unknown as AuthContext);

    expect(setActiveSpanAttributes).toHaveBeenCalledWith({
      [AfAttribute.UserId]: "user-1",
      [AfAttribute.OrgId]: "org-1",
      [AfAttribute.AuthMethod]: "session",
    });
  });

  it("annotates loop runner claims", () => {
    annotateLoopRunnerSpan({
      organizationId: "org-2",
      loopId: "loop-9",
    } as unknown as LoopRunnerClaims);

    expect(setActiveSpanAttributes).toHaveBeenCalledWith({
      [AfAttribute.OrgId]: "org-2",
      [AfAttribute.LoopId]: "loop-9",
    });
  });
});
