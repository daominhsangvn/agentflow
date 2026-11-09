import { Result, Status } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
import { createFirstAdminAccount } from "@/lib/auth/better-auth";

export type FirstAdminInput = {
  email: string;
  password: string;
  name: string;
};

export const firstAdminBootstrapService = {
  async ensureFirstAdmin(
    input: FirstAdminInput
  ): Promise<
    Result<{ status: FirstAdminBootstrapStatus; userId: string | null }>
  > {
    try {
      // No ambient transaction: Better Auth commits its own writes and the
      // after-hook provisions the organization, as in a normal first sign-up.
      const existing = await withDb((db) => db.authUser.count());
      if (existing > 0) {
        return Result.ok({
          status: FirstAdminBootstrapStatus.Skipped,
          userId: null,
        });
      }
      const { userId } = await createFirstAdminAccount(input);
      return Result.ok({
        status: FirstAdminBootstrapStatus.Created,
        userId,
      });
    } catch (error) {
      log.error("First admin bootstrap failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return Result.err(Status.Error);
    }
  },
};

export const FirstAdminBootstrapStatus = {
  Created: "created",
  Skipped: "skipped",
} as const;
export type FirstAdminBootstrapStatus =
  (typeof FirstAdminBootstrapStatus)[keyof typeof FirstAdminBootstrapStatus];
