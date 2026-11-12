import type { JsonObject } from "@repo/api/src/types/common";
import { Result } from "@repo/api/src/types/result";
import { z } from "zod";
import {
  HttpMethod,
  type ProviderHttp,
  type ProviderHttpResponse,
} from "../../types";
import { teamsEndpoints } from "./endpoints";
import { rootMessageIdOf } from "./thread-ref";

/**
 * Calls to the Bot Connector service of a Teams activity (its serviceUrl):
 * sending a message to a conversation and reading a team's details. The
 * bot's token is only ever sent to Teams' own service hosts, whatever a
 * stored serviceUrl says.
 */

const CONNECTOR_TIMEOUT_MS = 15_000;
const TRAILING_SLASHES_RE = /\/+$/;

const teamDetailsSchema = z.looseObject({
  aadGroupId: z.string().min(1),
});

const sentActivitySchema = z.looseObject({ id: z.string().min(1) });

/** The service URL without trailing slashes when it is a Teams Bot Connector host, else null. */
export function checkServiceUrl(value: string | null | undefined): URL | null {
  const url = value
    ? URL.parse(value.trim().replace(TRAILING_SLASHES_RE, ""))
    : null;
  const endpoints = teamsEndpoints();
  // Emulated (dev only): the emulator's own origin may be plain http.
  const protocolOk =
    url?.protocol === "https:" ||
    (endpoints.emulated && url?.protocol === "http:");
  if (!(url && protocolOk) || url.username || url.password) {
    return null;
  }
  return endpoints.isServiceHost(url) ? url : null;
}

export async function sendToConversation(
  http: ProviderHttp,
  input: {
    serviceUrl: URL;
    token: string;
    conversationId: string;
    activity: JsonObject;
  }
): Promise<Result<{ id: string | null }, ProviderHttpResponse>> {
  const response = await http.request({
    method: HttpMethod.Post,
    url: `${connectorBase(input.serviceUrl)}/v3/conversations/${encodeURIComponent(input.conversationId)}/activities`,
    headers: { authorization: `Bearer ${input.token}` },
    body: input.activity,
    timeoutMs: CONNECTOR_TIMEOUT_MS,
  });
  if (!response.ok) {
    return Result.err(response);
  }
  const sent = sentActivitySchema.safeParse(response.json);
  return Result.ok({ id: sent.success ? sent.data.id : null });
}

/** Replaces a message the bot sent to a conversation. */
export async function updateActivity(
  http: ProviderHttp,
  input: {
    serviceUrl: URL;
    token: string;
    conversationId: string;
    activityId: string;
    activity: JsonObject;
  }
): Promise<Result<{ id: string | null }, ProviderHttpResponse>> {
  const response = await http.request({
    method: HttpMethod.Put,
    url: `${connectorBase(input.serviceUrl)}/v3/conversations/${encodeURIComponent(input.conversationId)}/activities/${encodeURIComponent(input.activityId)}`,
    headers: { authorization: `Bearer ${input.token}` },
    body: { ...input.activity, id: input.activityId },
    timeoutMs: CONNECTOR_TIMEOUT_MS,
  });
  if (!response.ok) {
    return Result.err(response);
  }
  const sent = sentActivitySchema.safeParse(response.json);
  return Result.ok({ id: sent.success ? sent.data.id : input.activityId });
}

/** The team's Microsoft 365 group id (Graph's team id), from its Teams id. */
export async function getTeamGroupId(
  http: ProviderHttp,
  input: { serviceUrl: URL; token: string; teamId: string }
): Promise<string | null> {
  const response = await http.request({
    method: HttpMethod.Get,
    url: `${connectorBase(input.serviceUrl)}/v3/teams/${encodeURIComponent(input.teamId)}`,
    headers: { authorization: `Bearer ${input.token}` },
    timeoutMs: CONNECTOR_TIMEOUT_MS,
  });
  const details = teamDetailsSchema.safeParse(response.json);
  return response.ok && details.success ? details.data.aadGroupId : null;
}

/** User-facing description of a failed send. */
export function describeConnectorFailure(
  response: ProviderHttpResponse
): string {
  if (response.status === 0) {
    return "Could not reach the Teams Bot Connector (network error or timeout).";
  }
  if (response.status === 401 || response.status === 403) {
    return `Teams refused the bot's message (HTTP ${response.status}). Check that the bot's app registration and client secret are those of the Azure Bot, and that the app is still installed in the team.`;
  }
  if (response.status === 404) {
    return "Teams did not find the conversation (HTTP 404): the thread may have been deleted, or the app removed from the team.";
  }
  if (response.status === 429) {
    return "Teams is throttling the bot (HTTP 429).";
  }
  if (response.status >= 500) {
    return `Microsoft Teams had a temporary error (HTTP ${response.status}).`;
  }
  return `Teams did not accept the bot's message (HTTP ${response.status}).`;
}

function connectorBase(serviceUrl: URL): string {
  return serviceUrl.toString().replace(TRAILING_SLASHES_RE, "");
}

/** The global Bot Connector URL for a proactive message when no activity gave a serviceUrl. */
export function teamsGlobalServiceUrl(): string {
  return teamsEndpoints().globalServiceUrl;
}

const MEMBERS_PAGE_SIZE = 500;

const createdConversationSchema = z.looseObject({
  id: z.string().min(1),
  activityId: z.string().nullish(),
});

const teamsMemberSchema = z.looseObject({
  id: z.string().min(1),
  objectId: z.string().nullish(),
  aadObjectId: z.string().nullish(),
  name: z.string().nullish(),
  givenName: z.string().nullish(),
  surname: z.string().nullish(),
  email: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
});
export type TeamsMember = z.infer<typeof teamsMemberSchema>;

const pagedMembersSchema = z.looseObject({
  members: z.array(teamsMemberSchema).default([]),
  continuationToken: z.string().nullish(),
});

/** Starts a new thread in a channel with the given activity. */
export async function createChannelThread(
  http: ProviderHttp,
  input: {
    serviceUrl: URL;
    token: string;
    tenantId: string;
    channelId: string;
    activity: JsonObject;
  }
): Promise<
  Result<
    { conversationId: string; rootMessageId: string },
    ProviderHttpResponse
  >
> {
  const response = await http.request({
    method: HttpMethod.Post,
    url: `${connectorBase(input.serviceUrl)}/v3/conversations`,
    headers: { authorization: `Bearer ${input.token}` },
    body: {
      isGroup: true,
      channelData: {
        channel: { id: input.channelId },
        tenant: { id: input.tenantId },
      },
      activity: input.activity,
      tenantId: input.tenantId,
    },
    timeoutMs: CONNECTOR_TIMEOUT_MS,
  });
  if (!response.ok) {
    return Result.err(response);
  }
  const created = createdConversationSchema.safeParse(response.json);
  const rootMessageId = created.success
    ? (rootMessageIdOf(created.data.id) ?? created.data.activityId)
    : null;
  if (!(created.success && rootMessageId)) {
    return Result.err(response);
  }
  return Result.ok({ conversationId: created.data.id, rootMessageId });
}

/** One member of a conversation by Teams id, UPN or Entra object id; null when not a member. */
export async function getConversationMember(
  http: ProviderHttp,
  input: {
    serviceUrl: URL;
    token: string;
    conversationId: string;
    userId: string;
  }
): Promise<Result<TeamsMember | null, ProviderHttpResponse>> {
  const response = await http.request({
    method: HttpMethod.Get,
    url: `${connectorBase(input.serviceUrl)}/v3/conversations/${encodeURIComponent(input.conversationId)}/members/${encodeURIComponent(input.userId)}`,
    headers: { authorization: `Bearer ${input.token}` },
    timeoutMs: CONNECTOR_TIMEOUT_MS,
  });
  if (response.status === 404) {
    return Result.ok(null);
  }
  if (!response.ok) {
    return Result.err(response);
  }
  const member = teamsMemberSchema.safeParse(response.json);
  return Result.ok(member.success ? member.data : null);
}

/** One page of a conversation's roster. */
export async function listConversationMembers(
  http: ProviderHttp,
  input: {
    serviceUrl: URL;
    token: string;
    conversationId: string;
    continuationToken?: string | null;
  }
): Promise<
  Result<
    { members: TeamsMember[]; continuationToken: string | null },
    ProviderHttpResponse
  >
> {
  const query = new URLSearchParams({ pageSize: String(MEMBERS_PAGE_SIZE) });
  if (input.continuationToken) {
    query.set("continuationToken", input.continuationToken);
  }
  const response = await http.request({
    method: HttpMethod.Get,
    url: `${connectorBase(input.serviceUrl)}/v3/conversations/${encodeURIComponent(input.conversationId)}/pagedmembers?${query.toString()}`,
    headers: { authorization: `Bearer ${input.token}` },
    timeoutMs: CONNECTOR_TIMEOUT_MS,
  });
  if (!response.ok) {
    return Result.err(response);
  }
  const page = pagedMembersSchema.safeParse(response.json);
  return Result.ok({
    members: page.success ? page.data.members : [],
    continuationToken: page.success
      ? (page.data.continuationToken ?? null)
      : null,
  });
}
