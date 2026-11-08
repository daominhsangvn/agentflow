import { z } from "zod";

/**
 * The agent a case-page message is addressed to (payload.toAgent, written by
 * the case-message service): the orchestrator relays it to that agent.
 * `openQuestionTaskId` is set when the agent had a task with open questions
 * at write time: the message then answers them.
 */

const toAgentPayloadSchema = z.looseObject({
  toAgent: z.object({
    computeTargetId: z.string(),
    name: z.string(),
    openQuestionTaskId: z.string().optional(),
  }),
});

export function readMessageToAgent(payload: unknown): {
  computeTargetId: string;
  name: string;
  openQuestionTaskId?: string;
} | null {
  const parsed = toAgentPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.toAgent : null;
}
