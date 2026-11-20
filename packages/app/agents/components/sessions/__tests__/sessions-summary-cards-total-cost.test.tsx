import { AgentSessionViewerScope } from "@repo/api/src/types/agent-session";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionsCostBasis } from "../cost-card-presentation";
import {
  SESSIONS_COST_METRIC_CARD_LABEL,
  SESSIONS_COST_NO_COST_RECORDED_DETAIL,
  SESSIONS_TOTAL_COST_METRIC_CARD_LABEL,
} from "../cost-metric-card";
import { createAgentSessionUsageSummaryFixture } from "../session-list-fixtures";
import { SessionsSummaryCards } from "../sessions-summary-cards";

const TOTAL_LABEL = "Est. cost";
const LOC_PER_DOLLAR_PATTERN = /LOC \/ \$/;
const SUBSCRIPTION_CAPTION = /subscription-covered/;

function subscriptionCohort(
  overrides: Parameters<typeof createAgentSessionUsageSummaryFixture>[1] = {}
) {
  return createAgentSessionUsageSummaryFixture(
    AgentSessionViewerScope.Organization,
    {
      apiEstimatedCost: 0,
      subscriptionEstimatedCost: 4.2,
      totalEstimatedCost: 4.2,
      totalInputTokens: 400_000,
      totalOutputTokens: 200_000,
      totalSessions: 3,
      ...overrides,
    }
  );
}

describe("SessionsSummaryCards subscription-inclusive cost basis", () => {
  it("headlines the inclusive total with the subscription caption", () => {
    render(
      <SessionsSummaryCards
        costBasis={SessionsCostBasis.Total}
        isLoading={false}
        usage={subscriptionCohort()}
      />
    );

    expect(SESSIONS_TOTAL_COST_METRIC_CARD_LABEL).toBe(TOTAL_LABEL);
    expect(screen.getByText(TOTAL_LABEL)).toBeInTheDocument();
    expect(screen.getByText("$4")).toBeInTheDocument();
    expect(screen.getByText(SUBSCRIPTION_CAPTION)).toBeInTheDocument();
  });

  it("keeps the API-billed behaviour without the prop", () => {
    render(
      <SessionsSummaryCards isLoading={false} usage={subscriptionCohort()} />
    );

    expect(
      screen.getByText(SESSIONS_COST_METRIC_CARD_LABEL)
    ).toBeInTheDocument();
    expect(screen.queryByText(TOTAL_LABEL)).toBeNull();
    expect(screen.getByText("$0")).toBeInTheDocument();
  });

  it("still dashes when nothing was priced", () => {
    render(
      <SessionsSummaryCards
        costBasis={SessionsCostBasis.Total}
        isLoading={false}
        usage={subscriptionCohort({
          subscriptionEstimatedCost: 0,
          totalEstimatedCost: 0,
        })}
      />
    );

    expect(screen.queryByText("$0")).toBeNull();
    expect(
      screen.getByText(SESSIONS_COST_NO_COST_RECORDED_DETAIL)
    ).toBeInTheDocument();
  });
});

describe("SessionsSummaryCards without the delivery cards", () => {
  it("hides PRs Shipped and LOC / $ and divides the cost by sessions", () => {
    render(
      <SessionsSummaryCards
        costBasis={SessionsCostBasis.Total}
        isLoading={false}
        showDeliveryCards={false}
        usage={subscriptionCohort({ totalEstimatedCost: 6, totalSessions: 3 })}
      />
    );

    expect(screen.getByText("Avg cost / session")).toBeInTheDocument();
    expect(screen.queryByText("PRs Shipped")).toBeNull();
    expect(screen.queryByText(LOC_PER_DOLLAR_PATTERN)).toBeNull();
    expect(screen.getByText("$2")).toBeInTheDocument();
  });

  it("dashes the average when the cost tile is dashed", () => {
    render(
      <SessionsSummaryCards
        costBasis={SessionsCostBasis.Total}
        isLoading={false}
        showDeliveryCards={false}
        usage={subscriptionCohort({
          subscriptionEstimatedCost: 0,
          totalEstimatedCost: 0,
        })}
      />
    );

    expect(screen.getByText("Avg cost / session")).toBeInTheDocument();
    expect(screen.queryByText("$0")).toBeNull();
  });
});
