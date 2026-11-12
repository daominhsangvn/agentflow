#!/usr/bin/env node
/**
 * Dev only. Never point a production API at it.
 *
 * A small Microsoft Teams stand-in for local end-to-end runs over HTTP. With
 * TEAMS_EMULATOR_URL set on the API (apps/api/.env.local) the API reads its
 * Bot Framework keys, Entra token, Bot Connector and Graph from here, and this
 * script plays the Teams user: POST /control/send delivers a signed message
 * activity to the connection's inbound URL.
 *
 *   node scripts/dev/teams-emulator.mjs --port 3990 --app-id <guid> --tenant-id <guid>
 *
 * Flags: --port, --app-id, --tenant-id, --team-id, --users <json file>.
 * State is in memory. Dependencies: node only.
 */
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ISSUER = "https://api.botframework.com";
const DEFAULT_CHANNEL = "19:general@thread.tacv2";
const BOT_NAME = "AgentFlow";
const MESSAGE_ID_RE = /;messageid=(\d+)/;
const FLAG_PREFIX_RE = /^--/;
const JSON_HEADERS = { "content-type": "application/json" };

export async function startEmulator(options = {}) {
  const appId = options.appId ?? "00000000-0000-4000-8000-0000000000aa";
  const tenantId = (
    options.tenantId ?? "00000000-0000-4000-8000-0000000000bb"
  ).toLowerCase();
  const teamId = options.teamId ?? "eeeeeeee-1111-4222-8333-ffffffffffff";
  const users =
    options.users ??
    JSON.parse(
      readFileSync(
        options.usersFile ?? join(HERE, "teams-emulator.users.json"),
        "utf8"
      )
    );
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const kid = `emulator-${randomUUID().slice(0, 8)}`;
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid,
    use: "sig",
    alg: "RS256",
    endorsements: ["msteams"],
  };

  /** @type {Array<Record<string, unknown>>} */
  const messages = [];
  /** root id -> channel id */
  const roots = new Map();
  let lastId = Date.now();
  let origin = "";
  const nextId = () => String(++lastId);

  function record(entry) {
    const stored = { createdDateTime: new Date().toISOString(), ...entry };
    messages.push(stored);
    return stored;
  }

  function findUser(key) {
    const wanted = decodeURIComponent(key).toLowerCase();
    return users.find((user) =>
      [user.id, user.objectId, user.upn, user.email].some(
        (value) => value?.toLowerCase() === wanted
      )
    );
  }

  const memberOf = (user) => ({
    id: user.id,
    objectId: user.objectId,
    name: user.name,
    email: user.email,
    userPrincipalName: user.upn,
  });

  function botAccount() {
    return { id: `28:${appId}`, name: BOT_NAME };
  }

  function graphMessage(entry) {
    const fromBot = entry.from === "bot";
    const user = fromBot
      ? undefined
      : users.find((candidate) => candidate.name === entry.from);
    return {
      id: entry.id,
      replyToId: entry.kind === "reply" ? entry.rootId : null,
      messageType: "message",
      createdDateTime: entry.createdDateTime,
      body: { contentType: "html", content: entry.html ?? entry.text ?? "" },
      from: fromBot
        ? { application: { id: appId, displayName: BOT_NAME } }
        : { user: { id: user?.objectId ?? null, displayName: entry.from } },
      attachments: entry.attachments ?? [],
      mentions: entry.mentions ?? [],
    };
  }

  function botActivityEntry(kind, channelId, rootId, id, activity) {
    const text = typeof activity?.text === "string" ? activity.text : "";
    const entities = Array.isArray(activity?.entities) ? activity.entities : [];
    return record({
      id,
      kind,
      from: "bot",
      channelId,
      rootId,
      text,
      html: text,
      attachments: activity?.attachments ?? [],
      mentions: entities
        .filter((entity) => entity?.type === "mention")
        .map((entity, index) => ({
          id: index,
          mentionText: entity.text ?? null,
          mentioned: {
            user: {
              id: entity.mentioned?.id ?? null,
              displayName: entity.mentioned?.name ?? null,
            },
          },
        })),
      activity,
    });
  }

  function signToken(serviceUrl) {
    const encode = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const head = encode({ alg: "RS256", typ: "JWT", kid });
    const body = encode({
      iss: ISSUER,
      aud: appId,
      serviceurl: serviceUrl,
      iat: now - 60,
      nbf: now - 60,
      exp: now + 300,
    });
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${head}.${body}`),
      privateKey
    ).toString("base64url");
    return `${head}.${body}.${signature}`;
  }

  async function handleSend(input) {
    const user = findUser(String(input.as ?? ""));
    if (!user) {
      return [404, { error: `unknown user ${input.as}` }];
    }
    if (typeof input.inbound !== "string") {
      return [400, { error: "inbound is required" }];
    }
    let channelId;
    let rootId;
    if (input.replyTo) {
      channelId = roots.get(String(input.replyTo));
      rootId = String(input.replyTo);
      if (!channelId) {
        return [404, { error: `unknown root ${input.replyTo}` }];
      }
    } else {
      channelId = input.channelId ?? [...roots.values()][0] ?? DEFAULT_CHANNEL;
      rootId = nextId();
      roots.set(rootId, channelId);
    }
    const id = input.replyTo ? nextId() : rootId;
    const serviceUrl = `${origin}/smba/teams/`;
    const bot = botAccount();
    const text = input.mentionBot
      ? `<at>${BOT_NAME}</at> ${input.text ?? ""}`
      : String(input.text ?? "");
    const activity = {
      type: "message",
      id,
      timestamp: new Date().toISOString(),
      channelId: "msteams",
      serviceUrl,
      from: { id: user.id, name: user.name, aadObjectId: user.objectId },
      conversation: {
        id: `${channelId};messageid=${rootId}`,
        conversationType: "channel",
        tenantId,
      },
      recipient: bot,
      text,
      textFormat: "plain",
      entities: input.mentionBot
        ? [{ type: "mention", mentioned: bot, text: `<at>${BOT_NAME}</at>` }]
        : [],
      channelData: {
        tenant: { id: tenantId },
        team: { id: `19:${teamId}@thread.tacv2`, aadGroupId: teamId },
        channel: { id: channelId },
      },
    };
    const response = await fetch(input.inbound, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        authorization: `Bearer ${signToken(serviceUrl)}`,
      },
      body: JSON.stringify(activity),
    });
    record({
      id,
      kind: input.replyTo ? "reply" : "root",
      from: user.name,
      channelId,
      rootId,
      text,
      html: text,
      delivery: { status: response.status },
    });
    return [200, { status: response.status, activityId: id, rootId }];
  }

  async function route(method, path, body) {
    const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
    const key = `${method} ${path}`;
    if (key === "GET /botframework/.well-known/openidconfiguration") {
      return [200, { jwks_uri: `${origin}/botframework/keys` }];
    }
    if (key === "GET /botframework/keys") {
      return [200, { keys: [jwk] }];
    }
    if (
      method === "POST" &&
      segments[0] === "entra" &&
      segments.at(-1) === "token"
    ) {
      return [
        200,
        {
          access_token: `emulator-token-${randomUUID()}`,
          token_type: "Bearer",
          expires_in: 3600,
        },
      ];
    }
    if (key === "GET /control/messages") {
      return [200, messages];
    }
    if (key === "POST /control/send") {
      return await handleSend(body ?? {});
    }
    if (segments[0] === "smba" && segments[2] === "v3") {
      return connector(method, segments.slice(3), body);
    }
    if (segments[0] === "graph" && segments[1] === "v1.0" && method === "GET") {
      return graph(segments.slice(2));
    }
    return [404, { error: "not found" }];
  }

  function connector(method, rest, body) {
    if (method === "POST" && rest.join("/") === "conversations") {
      return createConversation(body);
    }
    if (rest[0] === "conversations" && rest[2] === "activities") {
      return conversationActivity(method, rest, body);
    }
    if (method === "GET" && rest[0] === "conversations") {
      return conversationMembers(rest);
    }
    if (method === "GET" && rest[0] === "teams" && rest[1]) {
      return [200, { id: rest[1], aadGroupId: teamId }];
    }
    return [404, { error: "not found" }];
  }

  function createConversation(body) {
    const channelId = body?.channelData?.channel?.id ?? DEFAULT_CHANNEL;
    const id = nextId();
    roots.set(id, channelId);
    botActivityEntry("root", channelId, id, id, body?.activity);
    return [201, { id: `${channelId};messageid=${id}`, activityId: id }];
  }

  function conversationActivity(method, rest, body) {
    const root = MESSAGE_ID_RE.exec(rest[1])?.[1];
    const channelId = (root && roots.get(root)) ?? rest[1].split(";")[0];
    if (method === "POST") {
      const id = nextId();
      botActivityEntry("reply", channelId, root ?? id, id, body);
      return [200, { id }];
    }
    if (method === "PUT" && rest[3]) {
      const existing = messages.find((entry) => entry.id === rest[3]);
      if (existing) {
        existing.text =
          typeof body?.text === "string" ? body.text : existing.text;
        existing.html = existing.text;
        existing.activity = body;
      }
      return [200, { id: rest[3] }];
    }
    return [404, { error: "not found" }];
  }

  function conversationMembers(rest) {
    if (rest[2] === "members" && rest[3]) {
      const user = findUser(rest[3]);
      return user
        ? [200, memberOf(user)]
        : [404, { error: "member not found" }];
    }
    if (rest[2] === "pagedmembers") {
      return [200, { members: users.map(memberOf), continuationToken: null }];
    }
    return [404, { error: "not found" }];
  }

  function graph(rest) {
    if (
      rest[0] !== "teams" ||
      rest[2] !== "channels" ||
      rest[4] !== "messages" ||
      !rest[5]
    ) {
      return [404, { error: "not found" }];
    }
    const rootId = rest[5];
    const thread = messages.filter(
      (entry) => entry.rootId === rootId && entry.channelId === rest[3]
    );
    if (rest[6] === "replies") {
      const replies = thread.filter(
        (entry) => entry.kind === "reply" && (!rest[7] || entry.id === rest[7])
      );
      if (rest[7]) {
        return replies[0]
          ? [200, graphMessage(replies[0])]
          : [404, { error: "not found" }];
      }
      return [200, { value: replies.map(graphMessage) }];
    }
    const root = thread.find((entry) => entry.kind === "root");
    return root ? [200, graphMessage(root)] : [404, { error: "not found" }];
  }

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const url = new URL(request.url ?? "/", "http://emulator");
      let body;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw && (request.headers["content-type"] ?? "").includes("json")) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = undefined;
        }
      }
      let result;
      try {
        result = await route(request.method ?? "GET", url.pathname, body);
      } catch (error) {
        result = [500, { error: String(error) }];
      }
      response.writeHead(result[0], JSON_HEADERS);
      response.end(JSON.stringify(result[1]));
    });
  });
  await new Promise((resolve) => server.listen(options.port ?? 3990, resolve));
  origin = `http://localhost:${server.address().port}`;
  return {
    origin,
    appId,
    tenantId,
    messages,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 2) {
    flags[argv[index].replace(FLAG_PREFIX_RE, "")] = argv[index + 1];
  }
  return flags;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flags = parseFlags(process.argv.slice(2));
  const emulator = await startEmulator({
    port: flags.port ? Number(flags.port) : 3990,
    appId: flags["app-id"],
    tenantId: flags["tenant-id"],
    teamId: flags["team-id"],
    usersFile: flags.users,
  });
  console.log(`Teams emulator (dev only) on ${emulator.origin}`);
  console.log(`  app id:    ${emulator.appId}`);
  console.log(`  tenant id: ${emulator.tenantId}`);
  console.log(`  API env:   TEAMS_EMULATOR_URL=${emulator.origin}`);
}
