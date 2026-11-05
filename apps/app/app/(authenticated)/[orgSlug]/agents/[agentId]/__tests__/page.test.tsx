import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentDetailPage from "../page";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("../../../../components/header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("@repo/app/compute/components/agent-detail-view", () => ({
  AgentDetailView: ({
    agentId,
    notFoundHref,
  }: {
    agentId: string;
    notFoundHref: string;
  }) => (
    <div
      data-agent-id={agentId}
      data-not-found-href={notFoundHref}
      data-testid="agent-detail-view"
    />
  ),
}));

const AGENT_ID = "0b0c9a52-3f0e-4f43-9d58-2f6f7a8f1c11";

describe("AgentDetailPage", () => {
  beforeEach(() => {
    mocks.redirect.mockReset();
    // redirect() never returns in Next.js; mimic that so the page stops.
    mocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });
  });

  it("redirects a non-UUID slug to the skills catalog and keeps the query", async () => {
    await expect(
      AgentDetailPage({
        params: Promise.resolve({ orgSlug: "acme", agentId: "command::foo" }),
        searchParams: Promise.resolve({ tab: "branches" }),
      })
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/acme/skills/command%3A%3Afoo?tab=branches"
    );
  });

  it("redirects without a query string when there are no search params", async () => {
    await expect(
      AgentDetailPage({
        params: Promise.resolve({ orgSlug: "acme", agentId: "some-slug" }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith("/acme/skills/some-slug");
  });

  it("renders the view for a UUID with the catalog as the not-found target", async () => {
    render(
      await AgentDetailPage({
        params: Promise.resolve({ orgSlug: "acme", agentId: AGENT_ID }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mocks.redirect).not.toHaveBeenCalled();
    const view = screen.getByTestId("agent-detail-view");
    expect(view).toHaveAttribute("data-agent-id", AGENT_ID);
    expect(view).toHaveAttribute(
      "data-not-found-href",
      `/acme/skills/${AGENT_ID}`
    );
  });
});
