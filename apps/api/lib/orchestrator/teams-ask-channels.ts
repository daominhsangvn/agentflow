import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import { Result } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import {
  type TeamsAskChannel,
  teamsAskChannels,
  teamsProjectSettingsSchema,
} from "@/lib/integrations/providers/microsoft-teams/project";
import { parseChannelReference } from "@/lib/integrations/providers/microsoft-teams/thread-ref";

/** An ask channel of a Teams project connection the workflow was granted `ask` on. */
export type TeamsAskChannelOption = TeamsAskChannel & {
  connectionKey: string;
  projectConnectionId: string;
};

/** The ask channels of the project's Teams connections whose keys are granted. */
export async function loadTeamsAskChannels(
  organizationId: string,
  projectId: string,
  keys: ReadonlySet<string>
): Promise<TeamsAskChannelOption[]> {
  if (keys.size === 0) {
    return [];
  }
  const rows = await withDb((db) =>
    db.projectConnection.findMany({
      where: {
        organizationId,
        projectId,
        key: { in: [...keys] },
        connection: { provider: IntegrationProviderKey.MicrosoftTeams },
      },
      select: { id: true, key: true, settings: true },
      orderBy: { createdAt: "asc" },
    })
  );
  return rows.flatMap((row) => {
    const settings = teamsProjectSettingsSchema.safeParse(row.settings);
    if (!settings.success) {
      return [];
    }
    return teamsAskChannels(settings.data).map((channel) => ({
      ...channel,
      connectionKey: row.key,
      projectConnectionId: row.id,
    }));
  });
}

/** The ask channel a call names (alias or id), or the only one when it names none. */
export function resolveTeamsAskChannel(
  options: TeamsAskChannelOption[],
  input: { channel?: string; connection?: string }
): Result<TeamsAskChannelOption, string> {
  let pool = options;
  if (input.connection) {
    pool = options.filter(
      (option) => option.connectionKey === input.connection
    );
    if (pool.length === 0) {
      const keys = [...new Set(options.map((option) => option.connectionKey))];
      return Result.err(`connection: one of ${keys.join(", ")}.`);
    }
  }
  if (input.channel?.trim()) {
    return matchChannel(pool, input.channel);
  }
  if (pool.length === 0) {
    return Result.err(
      "No Ask channel: add one on the Teams project connection (Ask channels)."
    );
  }
  if (pool.length > 1) {
    return Result.err(
      `channel is required: one of ${describeAskChannels(pool)}.`
    );
  }
  return Result.ok(pool[0] as TeamsAskChannelOption);
}

/** `alias (connection key)` per channel, for messages and the prompt. */
export function describeAskChannels(options: TeamsAskChannelOption[]): string {
  return options
    .map((option) => `${option.alias} (${option.connectionKey})`)
    .join(", ");
}

function matchChannel(
  pool: TeamsAskChannelOption[],
  channel: string
): Result<TeamsAskChannelOption, string> {
  const alias = channel.trim().toLowerCase();
  const reference = parseChannelReference(channel);
  const found = pool.filter(
    (option) =>
      option.alias === alias ||
      (reference.ok && option.channelId === reference.value)
  );
  if (found.length === 0) {
    return Result.err(
      `channel "${channel.trim()}" is not an allowed ask channel. Allowed: ${describeAskChannels(pool)}.`
    );
  }
  if (found.length > 1) {
    const keys = found.map((option) => option.connectionKey).join(", ");
    return Result.err(
      `channel "${channel.trim()}" is on several Teams connections: pass connection (${keys}).`
    );
  }
  return Result.ok(found[0] as TeamsAskChannelOption);
}
