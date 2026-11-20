import type { IntegrationSessionGrant } from "@repo/api/src/types/integration-tools";
import { OrchestratorTurnStatus } from "@repo/api/src/types/orchestrator";
import { Result, Status, type StatusCode } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
import { computeTargetsService } from "@/app/compute-targets/service";
import { mintOrchestratorToken } from "@/app/orchestrator-tools/token";
import { env } from "@/env";
import { clearRunnersRead } from "@/lib/orchestrator/runners-read";
import { readTurnTimeoutMs } from "@/lib/orchestrator/turn-usage";

/**
 * The orchestrator's runner exchanges a running turn for the turn's tool
 * session token (docs/orchestrator.md): only for a computer the caller owns,
 * and only the computer the turn was sent to. Exchanging again replaces the
 * token; it stops working when the turn ends. Exchanging again with `freshSession`
 * (the runner replaced a session it no longer has) also clears what the conversation
 * read through runners_list.
 */

const DEFAULT_MCP_URL = "http://localhost:3010/mcp";
/** Past the turn's own limit, for the last calls of a slow turn. */
const TOKEN_GRACE_MS = 10 * 60_000;

export const desktopOrchestratorSessionService = {
  async issue(input: {
    organizationId: string;
    userId: string;
    clerkUserId: string | null;
    computeTargetId: string;
    turnId: string;
    freshSession: boolean;
  }): Promise<Result<IntegrationSessionGrant, StatusCode>> {
    const target = await computeTargetsService.findOwnedById(
      input.computeTargetId,
      input.organizationId,
      input.userId,
      input.clerkUserId
    );
    if (!target) {
      return Result.err(Status.Forbidden);
    }
    const turn = await withDb((db) =>
      db.orchestratorTurn.findFirst({
        where: {
          id: input.turnId,
          organizationId: input.organizationId,
          computeTargetId: input.computeTargetId,
          status: OrchestratorTurnStatus.Running,
        },
        select: { startedAt: true, usage: true, conversationId: true },
      })
    );
    if (!turn) {
      return Result.err(Status.NotFound);
    }
    const expiresAt = new Date(
      turn.startedAt.getTime() + readTurnTimeoutMs(turn.usage) + TOKEN_GRACE_MS
    );
    const { token, hash } = mintOrchestratorToken();
    const updated = await withDb.tx(async () => {
      const swapped = await withDb((db) =>
        db.orchestratorTurn.updateMany({
          where: { id: input.turnId, status: OrchestratorTurnStatus.Running },
          data: { tokenHash: hash, tokenExpiresAt: expiresAt },
        })
      );
      if (swapped.count === 1 && input.freshSession) {
        await clearRunnersRead(input.organizationId, turn.conversationId);
      }
      return swapped;
    });
    if (updated.count !== 1) {
      return Result.err(Status.NotFound);
    }
    if (input.freshSession) {
      log.info("orchestrator.runners_read.cleared", {
        organizationId: input.organizationId,
        conversationId: turn.conversationId,
        turnId: input.turnId,
        cause: "session_replaced",
      });
    }
    return Result.ok({
      token,
      expiresAt: expiresAt.toISOString(),
      mcpUrl: env.AGENTFLOW_MCP_URL ?? DEFAULT_MCP_URL,
    });
  },
};
