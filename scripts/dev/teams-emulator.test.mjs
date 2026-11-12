import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { startEmulator } from "./teams-emulator.mjs";

let emulator;
let inbound;
let received;
let inboundServer;

before(async () => {
  emulator = await startEmulator({
    port: 0,
    appId: "app-1",
    tenantId: "TENANT-1",
  });
  received = [];
  inboundServer = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        authorization: request.headers.authorization,
        activity: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      response.writeHead(200).end("{}");
    });
  });
  await new Promise((resolve) => inboundServer.listen(0, resolve));
  inbound = `http://localhost:${inboundServer.address().port}/inbound`;
});

after(async () => {
  await emulator.close();
  await new Promise((resolve) => inboundServer.close(resolve));
});

const get = (path) => fetch(`${emulator.origin}${path}`);
const post = (path, body) =>
  fetch(`${emulator.origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("teams emulator", () => {
  it("signs inbound activities with a key from its JWKS", async () => {
    const metadata = await (
      await get("/botframework/.well-known/openidconfiguration")
    ).json();
    const { keys } = await (await fetch(metadata.jwks_uri)).json();
    const result = await (
      await post("/control/send", {
        inbound,
        as: "an@contoso.test",
        root: "new",
        mentionBot: true,
        text: "hi",
      })
    ).json();
    assert.equal(result.status, 200);
    const token = received.at(-1).authorization.replace("Bearer ", "");
    const [head, body, signature] = token.split(".");
    const header = JSON.parse(Buffer.from(head, "base64url"));
    const key = keys.find((candidate) => candidate.kid === header.kid);
    assert.ok(key);
    assert.ok(
      verify(
        "RSA-SHA256",
        Buffer.from(`${head}.${body}`),
        createPublicKey({ key, format: "jwk" }),
        Buffer.from(signature, "base64url")
      )
    );
    const claims = JSON.parse(Buffer.from(body, "base64url"));
    assert.equal(claims.iss, "https://api.botframework.com");
    assert.equal(claims.aud, "app-1");
    const activity = received.at(-1).activity;
    assert.equal(activity.channelData.tenant.id, "tenant-1");
    assert.equal(activity.entities[0].mentioned.id, "28:app-1");
  });

  it("finds members by UPN and by email, and 404s unknown ones", async () => {
    const base = "/smba/teams/v3/conversations/c/members";
    assert.equal((await get(`${base}/chi@contoso.test`)).status, 200);
    assert.equal((await get(`${base}/nobody@contoso.test`)).status, 404);
    const paged = await (
      await get("/smba/teams/v3/conversations/c/pagedmembers")
    ).json();
    assert.ok(
      paged.members.some((member) => member.email === "chi.nguyen@contoso.test")
    );
  });

  it("records created threads with their channel and replies in the right channel", async () => {
    const roots = [];
    for (const channel of ["19:qabackend@thread.tacv2", "19:ba@thread.tacv2"]) {
      const created = await (
        await post("/smba/teams/v3/conversations", {
          channelData: { channel: { id: channel } },
          activity: { type: "message", text: `ask in ${channel}` },
        })
      ).json();
      assert.ok(created.activityId);
      roots.push(created.activityId);
    }
    const listed = await (await get("/control/messages")).json();
    assert.equal(
      listed.find((entry) => entry.id === roots[1]).channelId,
      "19:ba@thread.tacv2"
    );

    await post("/control/send", {
      inbound,
      as: "binh@contoso.test",
      replyTo: roots[1],
      mentionBot: true,
      text: "answer",
    });
    assert.equal(
      received.at(-1).activity.conversation.id,
      `19:ba@thread.tacv2;messageid=${roots[1]}`
    );
    const missing = await post("/control/send", {
      inbound,
      as: "binh@contoso.test",
      replyTo: "999",
    });
    assert.equal(missing.status, 404);
  });
});
