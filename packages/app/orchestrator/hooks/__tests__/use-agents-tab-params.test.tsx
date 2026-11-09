import { createMemoryNavigation } from "@repo/navigation/memory-adapter";
import { NavigationProvider } from "@repo/navigation/provider";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_NODE_ID } from "../../lib/agent-counters";
import { useAgentsTabParams } from "../use-agents-tab-params";

function renderParams(initialPath: string) {
  const nav = createMemoryNavigation({ initialPath });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NavigationProvider adapter={nav.adapter}>{children}</NavigationProvider>
  );
  return { nav, ...renderHook(() => useAgentsTabParams(), { wrapper }) };
}

function queryOf(href: string): URLSearchParams {
  const start = href.indexOf("?");
  return new URLSearchParams(start === -1 ? "" : href.slice(start + 1));
}

describe("useAgentsTabParams", () => {
  it("defaults to the orchestrator and no case", () => {
    const { result } = renderParams("/workflows/w1");

    expect(result.current.agent).toBe(ORCHESTRATOR_NODE_ID);
    expect(result.current.caseId).toBeNull();
  });

  it("reads agent and case from the URL", () => {
    const { result } = renderParams("/w?agent=ct-1&case=c-1");

    expect(result.current.agent).toBe("ct-1");
    expect(result.current.caseId).toBe("c-1");
  });

  it("selectAgent to another agent clears the case", () => {
    const { result, nav } = renderParams("/w?case=c-1");

    act(() => result.current.selectAgent("ct-2"));

    const params = queryOf(nav.getCurrentHref());
    expect(params.get("agent")).toBe("ct-2");
    expect(params.get("case")).toBeNull();
  });

  it("selecting the same agent keeps the case", () => {
    const { result, nav } = renderParams("/w?agent=ct-1&case=c-1");

    act(() => result.current.selectAgent("ct-1"));

    const params = queryOf(nav.getCurrentHref());
    expect(params.get("agent")).toBe("ct-1");
    expect(params.get("case")).toBe("c-1");
  });

  it("clears the case when moving between the orchestrator and an agent", () => {
    const { result, nav } = renderParams("/w?case=c-1");

    act(() => result.current.selectAgent("ct-1"));
    expect(queryOf(nav.getCurrentHref()).get("case")).toBeNull();

    const other = renderParams("/w?agent=ct-1&case=c-1");
    act(() => other.result.current.selectAgent(ORCHESTRATOR_NODE_ID));
    const params = queryOf(other.nav.getCurrentHref());
    expect(params.get("agent")).toBeNull();
    expect(params.get("case")).toBeNull();
  });

  it("omits agent when the orchestrator is selected", () => {
    const { result, nav } = renderParams("/w?agent=ct-1");

    act(() => result.current.selectAgent(ORCHESTRATOR_NODE_ID));

    expect(queryOf(nav.getCurrentHref()).get("agent")).toBeNull();
  });

  it("selectCase sets and clears the case", () => {
    const { result, nav } = renderParams("/w?agent=ct-1");

    act(() => result.current.selectCase("c-9"));
    expect(queryOf(nav.getCurrentHref()).get("case")).toBe("c-9");

    act(() => result.current.selectCase(null));
    const params = queryOf(nav.getCurrentHref());
    expect(params.get("case")).toBeNull();
    expect(params.get("agent")).toBe("ct-1");
  });
});
