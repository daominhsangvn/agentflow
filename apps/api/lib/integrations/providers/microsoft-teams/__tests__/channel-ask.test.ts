import { beforeEach, describe, expect, it } from "vitest";
import { postTeamsAsk, postTeamsAskThreadReply } from "../channel-ask";
import { clearEntraTokenCache } from "../entra-token";
import {
  jsonResponse,
  makeTeamsContext,
  type RouteHandler,
  routedHttp,
  tokenRoute,
} from "./teams.test-helpers";

const SERVICE_URL = new URL("https://smba.trafficmanager.net/emea");
const CHANNEL = "19:abc@thread.tacv2";
const MEMBERS = `/v3/conversations/${encodeURIComponent(CHANNEL)}/members/`;
const PAGED = `/v3/conversations/${encodeURIComponent(CHANNEL)}/pagedmembers`;

const an = { id: "29:an", objectId: "aad-an", name: "An" };

const createRoute: RouteHandler = (request) =>
  request.url.endsWith("/v3/conversations")
    ? jsonResponse({ id: `${CHANNEL};messageid=1700`, activityId: "1700" })
    : undefined;

function memberRoute(email: string, member: object): RouteHandler {
  return (request) =>
    request.url.endsWith(`${MEMBERS}${encodeURIComponent(email)}`)
      ? jsonResponse(member)
      : undefined;
}

function ask(http: ReturnType<typeof routedHttp>, emails: string[]) {
  return postTeamsAsk(makeTeamsContext({ http: http.http, bot: true }), {
    serviceUrl: SERVICE_URL,
    channelId: CHANNEL,
    emails,
    text: "Which timeout?",
  });
}

describe("postTeamsAsk", () => {
  beforeEach(() => {
    clearEntraTokenCache();
  });

  it("creates a channel thread with mention entities", async () => {
    const fake = routedHttp(
      tokenRoute,
      memberRoute("an@x.com", an),
      createRoute
    );
    const result = await ask(fake, ["an@x.com"]);
    expect(result.ok && result.value.rootMessageId).toBe("1700");
    expect(result.ok && result.value.messageId).toBe("1700");
    expect(result.ok && result.value.inThread).toBe(false);
    const post = fake.requests.find((r) => r.url.endsWith("/v3/conversations"));
    const body = post?.body as {
      isGroup: boolean;
      channelData: { channel: { id: string }; tenant: { id: string } };
      activity: { text: string; entities: { text: string }[] };
    };
    expect(body.isGroup).toBe(true);
    expect(body.channelData.channel.id).toBe(CHANNEL);
    expect(body.channelData.tenant.id).toBeTruthy();
    expect(body.activity.text).toContain(body.activity.entities[0]?.text);
    expect(body.activity.text).toContain("Which timeout?");
  });

  it("replies in the case's thread when threadRootId is given", async () => {
    const thread = `/v3/conversations/${encodeURIComponent(`${CHANNEL};messageid=1700`)}/activities`;
    const fake = routedHttp(
      tokenRoute,
      memberRoute("an@x.com", an),
      (request) =>
        request.url.endsWith(thread) ? jsonResponse({ id: "1750" }) : undefined
    );
    const result = await postTeamsAsk(
      makeTeamsContext({ http: fake.http, bot: true }),
      {
        serviceUrl: SERVICE_URL,
        channelId: CHANNEL,
        emails: ["an@x.com"],
        text: "Which timeout?",
        threadRootId: "1700",
      }
    );
    expect(result.ok && result.value.inThread).toBe(true);
    expect(result.ok && result.value.rootMessageId).toBe("1700");
    expect(result.ok && result.value.messageId).toBe("1750");
    expect(fake.requests.some((r) => r.url.endsWith(thread))).toBe(true);
    expect(fake.requests.some((r) => r.url.endsWith("/v3/conversations"))).toBe(
      false
    );
  });

  it("drops a leading @Name or Name: of a mentioned person from the text", async () => {
    for (const text of ["@An Which timeout?", "an: Which timeout?"]) {
      const fake = routedHttp(
        tokenRoute,
        memberRoute("an@x.com", an),
        createRoute
      );
      await postTeamsAsk(makeTeamsContext({ http: fake.http, bot: true }), {
        serviceUrl: SERVICE_URL,
        channelId: CHANNEL,
        emails: ["an@x.com"],
        text,
      });
      const post = fake.requests.find((r) =>
        r.url.endsWith("/v3/conversations")
      );
      const body = post?.body as { activity: { text: string } };
      expect(body.activity.text).toBe("<at>An</at>\n\nWhich timeout?");
    }
  });

  it("keeps text that only starts with the same letters as a name", async () => {
    const fake = routedHttp(
      tokenRoute,
      memberRoute("an@x.com", an),
      createRoute
    );
    await ask(fake, ["an@x.com"]);
    const post = fake.requests.find((r) => r.url.endsWith("/v3/conversations"));
    expect((post?.body as { activity: { text: string } }).activity.text).toBe(
      "<at>An</at>\n\nWhich timeout?"
    );
  });

  it("falls back to the message id of the conversation id", async () => {
    const fake = routedHttp(
      tokenRoute,
      memberRoute("an@x.com", an),
      (request) =>
        request.url.endsWith("/v3/conversations")
          ? jsonResponse({ id: `${CHANNEL};messageid=1800` })
          : undefined
    );
    const result = await ask(fake, ["an@x.com"]);
    expect(result.ok && result.value.rootMessageId).toBe("1800");
  });

  it("lower-cases emails before looking them up", async () => {
    const fake = routedHttp(
      tokenRoute,
      memberRoute("an@x.com", an),
      createRoute
    );
    const result = await ask(fake, ["An@X.com"]);
    expect(result.ok && result.value.mentions[0]?.id).toBe("29:an");
  });

  it("prefers the message id of the conversation id over activityId", async () => {
    const fake = routedHttp(
      tokenRoute,
      memberRoute("an@x.com", an),
      (request) =>
        request.url.endsWith("/v3/conversations")
          ? jsonResponse({
              id: `${CHANNEL};messageid=1900`,
              activityId: "other",
            })
          : undefined
    );
    const result = await ask(fake, ["an@x.com"]);
    expect(result.ok && result.value.rootMessageId).toBe("1900");
  });

  it("finds an email through the paged roster", async () => {
    const fake = routedHttp(
      tokenRoute,
      (request) =>
        request.url.includes(PAGED)
          ? jsonResponse({
              members: [{ id: "29:bo", name: "Bo", email: "BO@x.com" }],
            })
          : undefined,
      createRoute
    );
    const result = await ask(fake, ["bo@x.com"]);
    expect(result.ok && result.value.mentions[0]?.id).toBe("29:bo");
  });

  it("refuses an unknown email and posts nothing", async () => {
    const fake = routedHttp(tokenRoute, (request) =>
      request.url.includes(PAGED) ? jsonResponse({ members: [] }) : undefined
    );
    const result = await ask(fake, ["ghost@x.com"]);
    expect(!result.ok && result.error.error).toContain("ghost@x.com");
    expect(fake.requests.some((r) => r.url.endsWith("/v3/conversations"))).toBe(
      false
    );
  });

  it("describes a failed lookup", async () => {
    const fake = routedHttp(tokenRoute, (request) =>
      request.url.includes(MEMBERS) ? jsonResponse({}, 401) : undefined
    );
    const result = await ask(fake, ["an@x.com"]);
    expect(!result.ok && result.error.error).toContain("HTTP 401");
  });
});

describe("postTeamsAskThreadReply", () => {
  const THREAD = `/v3/conversations/${encodeURIComponent(`${CHANNEL};messageid=1700`)}/activities`;
  const sendRoute: RouteHandler = (request) =>
    request.url.endsWith(THREAD) ? jsonResponse({ id: "1701" }) : undefined;
  const known = [
    { email: "an@x.com", id: "29:an", aadObjectId: "aad-an", name: "An" },
  ];

  function reply(
    fake: ReturnType<typeof routedHttp>,
    emails: string[],
    mentions = known
  ) {
    return postTeamsAskThreadReply(
      makeTeamsContext({ http: fake.http, bot: true }),
      {
        serviceUrl: SERVICE_URL,
        channelId: CHANNEL,
        rootMessageId: "1700",
        emails,
        known: mentions,
        text: "Thanks",
      }
    );
  }

  beforeEach(() => {
    clearEntraTokenCache();
  });

  it("posts inside the thread conversation", async () => {
    const fake = routedHttp(tokenRoute, sendRoute);
    const result = await reply(fake, []);
    expect(result.ok && result.value.messageId).toBe("1701");
    expect(fake.requests.some((r) => r.url.endsWith(THREAD))).toBe(true);
  });

  it("reuses known mentions without a member lookup", async () => {
    const fake = routedHttp(tokenRoute, sendRoute);
    const result = await reply(fake, ["An@X.com"]);
    expect(result.ok && result.value.mentions[0]?.id).toBe("29:an");
    expect(fake.requests.some((r) => r.url.includes("/members"))).toBe(false);
  });

  it("refuses an unknown email that is not in the team", async () => {
    const fake = routedHttp(tokenRoute, sendRoute, (request) =>
      request.url.includes(PAGED) ? jsonResponse({ members: [] }) : undefined
    );
    const result = await reply(fake, ["ghost@x.com"]);
    expect(!result.ok && result.error.error).toContain("ghost@x.com");
    expect(fake.requests.some((r) => r.url.endsWith(THREAD))).toBe(false);
  });

  it("sends no entities with zero mentions", async () => {
    const fake = routedHttp(tokenRoute, sendRoute);
    await reply(fake, []);
    const post = fake.requests.find((r) => r.url.endsWith(THREAD));
    const body = post?.body as { text: string; entities?: unknown };
    expect(body.text).toBe("Thanks");
    expect(body.entities).toBeUndefined();
  });
});
