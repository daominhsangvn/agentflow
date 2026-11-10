import { render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Page, {
  generateMetadata,
} from "../app/(unauthenticated)/sign-up/[[...sign-up]]/page";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ host: "app.agentflow.ai" })),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  redirectMock.mockClear();
});

test("Sign Up Page", async () => {
  const { container } = render(
    await Page({ searchParams: Promise.resolve({}) })
  );
  expect(container).toBeDefined();
});

test("redirects to sign-in, keeping the query, when sign-up is disabled", async () => {
  vi.stubEnv("AUTH_ALLOW_SIGN_UP", "false");

  await expect(
    Page({ searchParams: Promise.resolve({ redirect_url: "/acme/prds" }) })
  ).rejects.toThrow("NEXT_REDIRECT");

  expect(redirectMock).toHaveBeenCalledWith(
    "/sign-in?redirect_url=%2Facme%2Fprds"
  );
});

test("still renders for an invitation link when sign-up is disabled", async () => {
  vi.stubEnv("AUTH_ALLOW_SIGN_UP", "false");

  const { container } = render(
    await Page({ searchParams: Promise.resolve({ email: "a@example.com" }) })
  );

  expect(container).toBeDefined();
  expect(redirectMock).not.toHaveBeenCalled();
});

// FEA-632 sends unauthenticated visitors (including link-unfurler bots) to
// sign-up, so this page must resolve document OG metadata from redirect_url
// like the sign-in page does — otherwise link previews show "Create an
// account" instead of the document title.
test("generateMetadata resolves document metadata from redirect_url", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json({ title: "My Feature", status: "IN_PROGRESS" })
  );

  const metadata = await generateMetadata({
    searchParams: Promise.resolve({
      redirect_url: "https://app.agentflow.ai/acme/features/FEA-3826",
    }),
  });

  expect(metadata.title).toBe("My Feature | AgentFlow");
});

test("generateMetadata falls back to sign-up metadata without redirect_url", async () => {
  const metadata = await generateMetadata({
    searchParams: Promise.resolve({}),
  });

  expect(metadata.title).toBe("Create an account | AgentFlow");
});

// /sign-up?redirect_url=/a&redirect_url=/b arrives as string[] — must fall
// back to the page metadata instead of throwing (previously a 500).
test("generateMetadata falls back for a repeated redirect_url param", async () => {
  const metadata = await generateMetadata({
    searchParams: Promise.resolve({ redirect_url: ["/a", "/b"] }),
  });

  expect(metadata.title).toBe("Create an account | AgentFlow");
});
