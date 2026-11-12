import {
  type IntegrationFieldDescriptor,
  IntegrationFieldKind,
} from "@repo/api/src/types/integration";
import { Result } from "@repo/api/src/types/result";
import { z } from "zod";
import type { IntegrationProjectDefinition } from "../../types";
import type { TeamsConnectionConfig } from "./connection";
import {
  channelNameOfLink,
  normalizeChannelReference,
  parseChannelReference,
} from "./thread-ref";

/**
 * Project connections of Teams: the channels whose bot mentions start this
 * project's workflows. A channel belongs to one project connection of the
 * organization (per bot tenant). No channels: the project connection only
 * posts (microsoft_teams.post_message) and claims nothing.
 */

const CHANNELS_MAX = 50;
const ASK_CHANNELS_MAX = 20;
const ASK_ALIAS_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ASK_ALIAS_MAX = 40;
const LINK_PREFIX_RE = /[/?:]/;
const NON_ALPHANUMERIC_RUN_RE = /[^a-z0-9]+/g;
const EDGE_DASHES_RE = /^-+|-+$/g;

/** A channel id or a Teams link to the channel, stored as the lower-cased channel id. */
export const teamsChannelSchema = z.string().transform((value, context) => {
  const parsed = parseChannelReference(value);
  if (!parsed.ok) {
    context.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }
  return parsed.value;
});

export const teamsProjectSettingsSchema = z
  .object({
    channels: z
      .array(teamsChannelSchema)
      .max(CHANNELS_MAX)
      .default([])
      .transform((channels) => [...new Set(channels)]),
    askChannels: z
      .array(z.string().transform(transformAskChannelEntry))
      .max(ASK_CHANNELS_MAX)
      .default([]),
  })
  .superRefine((settings, context) => {
    const problem = askChannelsProblem(settings.askChannels);
    if (problem) {
      context.addIssue({
        code: "custom",
        path: ["askChannels"],
        message: problem,
      });
    }
  });
export type TeamsProjectSettings = z.infer<typeof teamsProjectSettingsSchema>;

export const TEAMS_CHANNELS_FIELD_KEY = "channels";
export const TEAMS_ASK_CHANNELS_FIELD_KEY = "askChannels";

const TEAMS_PROJECT_SETTINGS_FIELDS: IntegrationFieldDescriptor[] = [
  {
    key: TEAMS_CHANNELS_FIELD_KEY,
    label: "Channels",
    kind: IntegrationFieldKind.StringList,
    placeholder:
      "https://teams.microsoft.com/l/channel/19%3a…%40thread.tacv2/…",
    description:
      'Channels where mentioning the bot starts this project\'s workflows: paste the link (••• next to the channel > "Get link to channel") or the channel id. A channel can belong to one project connection of the organization. Leave empty when the project only posts to Teams.',
  },
  {
    key: TEAMS_ASK_CHANNELS_FIELD_KEY,
    label: "Ask channels",
    kind: IntegrationFieldKind.StringList,
    placeholder: "qa-backend = https://teams.microsoft.com/l/channel/19%3a…",
    description:
      "Channels where the orchestrator's teams_ask may post questions and mention people, one per entry: name = channel link or id (the name may be left out for a channel link: it is taken from the channel name). Workflow rules refer to the name, e.g. backend questions → qa-backend. Replies there that mention the bot reach the case that asked. Each channel is claimed by this project connection.",
  },
];

export const teamsProjectDefinition: IntegrationProjectDefinition<
  TeamsConnectionConfig,
  TeamsProjectSettings
> = {
  settingsSchema: teamsProjectSettingsSchema,
  settingsFields: TEAMS_PROJECT_SETTINGS_FIELDS,
  containers: teamsClaimedChannels,
  normalizeContainer: normalizeChannelReference,
  // Channel ids are unique within a tenant; mentions only arrive from the bot's.
  origin: (config) => config.tenantId ?? "",
  triggerContainersField: TEAMS_CHANNELS_FIELD_KEY,
};

export type TeamsAskChannel = { alias: string; channelId: string };

/** "name = <link or id>", or just a channel link (the name comes from the channel's name). */
export function parseAskChannelEntry(
  entry: string
): Result<TeamsAskChannel, string> {
  // A link carries its own "=" (?groupId=…): only a prefix that is not part of a URL is a name.
  const first = entry.indexOf("=");
  const separator = LINK_PREFIX_RE.test(entry.slice(0, Math.max(first, 0)))
    ? -1
    : first;
  const aliasPart = separator < 0 ? null : entry.slice(0, separator).trim();
  const reference = separator < 0 ? entry : entry.slice(separator + 1);
  const channel = parseChannelReference(reference);
  if (!channel.ok) {
    return Result.err(channel.error);
  }
  const alias =
    aliasPart === null
      ? slugAlias(channelNameOfLink(reference))
      : aliasPart.toLowerCase();
  if (!alias) {
    return Result.err(
      `askChannels: "${entry.trim()}" needs a name: write name = <channel link or id>.`
    );
  }
  if (!ASK_ALIAS_RE.test(alias)) {
    return Result.err(
      `askChannels: "${alias}" is not a valid name: letters, digits, - or _, up to ${ASK_ALIAS_MAX}.`
    );
  }
  return Result.ok({ alias, channelId: channel.value });
}

export function formatAskChannelEntry(channel: TeamsAskChannel): string {
  return `${channel.alias} = ${channel.channelId}`;
}

/** The ask channels of stored settings; entries that no longer parse are skipped. */
export function teamsAskChannels(
  settings: Pick<TeamsProjectSettings, "askChannels">
): TeamsAskChannel[] {
  const channels: TeamsAskChannel[] = [];
  for (const entry of settings.askChannels) {
    const parsed = parseAskChannelEntry(entry);
    if (parsed.ok) {
      channels.push(parsed.value);
    }
  }
  return channels;
}

/** Channels this project connection claims: the mention channels plus every ask channel. */
export function teamsClaimedChannels(
  settings: Pick<TeamsProjectSettings, "channels" | "askChannels">
): string[] {
  return [
    ...new Set([
      ...settings.channels,
      ...teamsAskChannels(settings).map((channel) => channel.channelId),
    ]),
  ];
}

function transformAskChannelEntry(
  value: string,
  context: z.RefinementCtx
): string {
  const parsed = parseAskChannelEntry(value);
  if (!parsed.ok) {
    context.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }
  return formatAskChannelEntry(parsed.value);
}

function askChannelsProblem(entries: string[]): string | null {
  const aliases = new Set<string>();
  const ids = new Set<string>();
  for (const channel of teamsAskChannels({ askChannels: entries })) {
    if (aliases.has(channel.alias)) {
      return `askChannels: the name "${channel.alias}" is used twice.`;
    }
    if (ids.has(channel.channelId)) {
      return `askChannels: ${channel.channelId} is listed twice.`;
    }
    aliases.add(channel.alias);
    ids.add(channel.channelId);
  }
  return null;
}

function slugAlias(name: string | null): string {
  return (name ?? "")
    .toLowerCase()
    .replaceAll(NON_ALPHANUMERIC_RUN_RE, "-")
    .replaceAll(EDGE_DASHES_RE, "")
    .slice(0, ASK_ALIAS_MAX);
}
