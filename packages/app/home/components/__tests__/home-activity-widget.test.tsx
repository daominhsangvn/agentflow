import type {
  OrgActivityDay,
  OrgActivityStats,
} from "@repo/api/src/types/org-stats";
import { KPI_NO_VALUE } from "@repo/app/shared/lib/format-utils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityWidget } from "../home-activity-widget";

const RETRY_BUTTON = /retry|try again/i;

const mocks = vi.hoisted(() => ({
  activity: undefined as unknown,
}));

vi.mock("../../hooks/use-org-stats", () => ({
  useOrgActivityStats: () => mocks.activity,
}));

// Recharts needs layout jsdom lacks: render the series keys instead.
vi.mock("@repo/design-system/components/ui/time-series-area-chart", () => ({
  TimeSeriesAreaChart: (props: { series: { key: string }[] }) => (
    <div data-testid="chart">
      {props.series.map((series) => series.key).join(",")}
    </div>
  ),
}));

function day(overrides: Partial<OrgActivityDay> = {}): OrgActivityDay {
  return {
    day: "2026-11-18",
    sessions: 2,
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: null,
    runsSucceeded: 3,
    runsFailed: 1,
    runsCancelled: 0,
    casesOpened: 0,
    casesClosed: 0,
    ...overrides,
  };
}

function ok(data: OrgActivityStats) {
  return { data, isLoading: false, error: null, refetch: vi.fn() };
}

describe("ActivityWidget", () => {
  beforeEach(() => {
    mocks.activity = ok({
      days: [day(), day({ day: "2026-11-19", sessions: 3 })],
    });
  });

  it("renders the token chart and total by default", () => {
    render(<ActivityWidget />);
    expect(screen.getByTestId("chart").textContent).toBe(
      "inputTokens,outputTokens"
    );
    expect(screen.getByTestId("activity-total").textContent).toContain(
      "Total tokens"
    );
  });

  it("switches metric", async () => {
    render(<ActivityWidget />);
    await userEvent.click(screen.getByRole("radio", { name: "Sessions" }));
    expect(screen.getByTestId("chart").textContent).toBe("sessions");
    expect(screen.getByTestId("activity-total").textContent).toBe(
      "Total sessions: 5"
    );

    await userEvent.click(screen.getByRole("radio", { name: "Runs" }));
    expect(screen.getByTestId("chart").textContent).toBe(
      "succeeded,failed,cancelled"
    );
  });

  it("shows a dash total when every day's cost is unknown", async () => {
    render(<ActivityWidget />);
    await userEvent.click(screen.getByRole("radio", { name: "Cost" }));
    const total = screen.getByTestId("activity-total").textContent ?? "";
    expect(total).toContain(KPI_NO_VALUE);
    expect(total).not.toContain("$");
  });

  it("shows an error with retry", async () => {
    const refetch = vi.fn();
    mocks.activity = {
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch,
    };
    render(<ActivityWidget />);
    await userEvent.click(screen.getByRole("button", { name: RETRY_BUTTON }));
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByTestId("chart")).toBeNull();
  });
});
