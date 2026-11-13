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

test("Sign In Page", async () => {
  const { container } = render(
    await Page({ searchParams: Promise.resolve({}) })
  );
  expect(container).toBeDefined();
});

test("hides the sign-up link when sign-up is disabled", async () => {
  vi.stubEnv("AUTH_ALLOW_SIGN_UP", "false");

  const { findByText, queryByText } = render(
    await Page({ searchParams: Promise.resolve({}) })
  );

  await findByText("Welcome to AgentFlow");
  expect(queryByText("Create one")).toBeNull();
});

test("shows the sign-up link on invite-only installs when an invited email is present", async () => {
  vi.stubEnv("AUTH_ALLOW_SIGN_UP", "false");

  const { findByText } = render(
    await Page({ searchParams: Promise.resolve({ email: "a@b.c" }) })
  );

  await findByText("Create one");
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
