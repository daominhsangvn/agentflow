import { z } from "zod";

/**
 * The agent a case-page message is addressed to (payload.toAgent, written by
 * the case-message service): the orchestrator relays it to that agent.
 */

const toAgentPayloadSchema = z.looseObject({
  toAgent: z.object({ computeTargetId: z.string(), name: z.string() }),
});

export function readMessageToAgent(
  payload: unknown
): { computeTargetId: string; name: string } | null {
  const parsed = toAgentPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.toAgent : null;
}
