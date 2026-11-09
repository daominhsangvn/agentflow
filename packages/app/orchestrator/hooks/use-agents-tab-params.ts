"use client";

import { useNavigation } from "@repo/navigation/use-navigation";
import { usePath } from "@repo/navigation/use-path";
import { useSearchParamsValue } from "@repo/navigation/use-search-params-value";
import { useCallback } from "react";
import { ORCHESTRATOR_NODE_ID } from "../lib/agent-counters";

const AGENT_PARAM = "agent";
const CASE_PARAM = "case";

/**
 * Agents tab selection in the URL: `?agent=<computeTargetId>` (absent means
 * the orchestrator) and `?case=<caseId>`.
 */
export function useAgentsTabParams() {
  const navigation = useNavigation();
  const pathname = usePath();
  const searchParams = useSearchParamsValue();

  const agent = searchParams.get(AGENT_PARAM) || ORCHESTRATOR_NODE_ID;
  const caseId = searchParams.get(CASE_PARAM) || null;

  const write = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      navigation.replace(qs ? `${pathname}?${qs}` : pathname, {
        scroll: false,
      });
    },
    [navigation, pathname, searchParams]
  );

  const selectAgent = useCallback(
    (id: string) => {
      const next = id === ORCHESTRATOR_NODE_ID ? null : id;
      if (id === agent) {
        write({ [AGENT_PARAM]: next });
        return;
      }
      write({ [AGENT_PARAM]: next, [CASE_PARAM]: null });
    },
    [agent, write]
  );
  const selectCase = useCallback(
    (id: string | null) => write({ [CASE_PARAM]: id }),
    [write]
  );

  return { agent, caseId, selectAgent, selectCase };
}
