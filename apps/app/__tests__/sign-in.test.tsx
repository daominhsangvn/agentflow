import { render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Page, {
  generateMetadata,
} from "../app/(unauthenticated)/sign-in/[[...sign-in]]/page";

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ host: "app.agentflow.ai" })),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("Sign In Page", () => {
  const { container } = render(<Page />);
  expect(container).toBeDefined();
});

test("hides the sign-up link when sign-up is disabled", async () => {
  vi.stubEnv("AUTH_ALLOW_SIGN_UP", "false");

  const { findByText, queryByText } = render(<Page />);

  await findByText("Welcome to AgentFlow");
  expect(queryByText("Create one")).toBeNull();
});

test("generateMetadata resolves document metadata from redirect_url", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json({ title: "My PRD", type: "PRD" })
  );

  const metadata = await generateMetadata({
    searchParams: Promise.resolve({
      redirect_url: "https://app.agentflow.ai/acme/prds/PRD-1",
    }),
  });

  expect(metadata.title).toBe("My PRD | AgentFlow");
});

test("generateMetadata falls back to sign-in metadata without redirect_url", async () => {
  const metadata = await generateMetadata({
    searchParams: Promise.resolve({}),
  });

  expect(metadata.title).toBe("Welcome back | AgentFlow");
});
