import { expectCriticalAxeClean } from "@repo/app/test/a11y/axe";
import {
  A11yTheme,
  expectElementContrast,
  themeBackground,
} from "@repo/app/test/a11y/contrast";
import { A11yThemeRoot } from "@repo/app/test/a11y/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "../page";

vi.mock("@repo/app/home/components/home-dashboard", () => ({
  HomeDashboard: () => <section aria-label="Home statistics" />,
}));

vi.mock("../../../components/onboarding-checklist", () => ({
  OnboardingChecklist: () => null,
}));

vi.mock("../../../components/agent-onboarding-card", () => ({
  AgentOnboardingCard: () => null,
}));

vi.mock("@/app/(authenticated)/components/header", () => ({
  Header: ({ breadcrumbs }: { breadcrumbs: { label: string }[] }) => (
    <header>
      {breadcrumbs.map((breadcrumb) => breadcrumb.label).join(" / ")}
    </header>
  ),
}));

const SUBTITLE = "Your projects, workflows, cases and agents at a glance.";

describe("HomePage", () => {
  it("renders the Home heading, breadcrumb and statistics, without Insights", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("Home");
    expect(
      screen.getByRole("region", { name: "Home statistics" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Insights overview")).toBeNull();
  });

  it.each([
    A11yTheme.Light,
    A11yTheme.Dark,
  ])("keeps the home route critical a11y and contrast clean in %s theme", async (theme) => {
    const { container } = render(
      <A11yThemeRoot theme={theme}>
        <HomePage />
      </A11yThemeRoot>
    );

    await expectCriticalAxeClean(container);
    expectElementContrast(screen.getByText(SUBTITLE), {
      background: themeBackground(theme),
      label: `home route ${theme}`,
    });
  });
});
