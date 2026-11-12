#!/usr/bin/env node
/**
 * Dev only. Plays a Teams user against scripts/dev/teams-emulator.mjs.
 *
 *   node scripts/dev/teams-send.mjs --inbound <url> --as an@contoso.test \
 *     [--reply-to <rootId> | --root new] [--mention-bot] [--text "..."] \
 *     [--channel <id>] [--emulator http://localhost:3990]
 */
const args = process.argv.slice(2);
const flags = {};
for (let index = 0; index < args.length; index += 1) {
  const name = args[index].replace(/^--/, "");
  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    flags[name] = true;
  } else {
    flags[name] = next;
    index += 1;
  }
}

if (!(flags.inbound && flags.as)) {
  console.error(
    "Usage: teams-send.mjs --inbound <url> --as <email> [--reply-to <rootId> | --root new] [--mention-bot] [--text <text>] [--channel <id>]"
  );
  process.exit(2);
}

const emulator =
  typeof flags.emulator === "string" ? flags.emulator : "http://localhost:3990";
const response = await fetch(`${emulator}/control/send`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    inbound: flags.inbound,
    as: flags.as,
    text: typeof flags.text === "string" ? flags.text : "",
    replyTo:
      typeof flags["reply-to"] === "string" ? flags["reply-to"] : undefined,
    root: flags.root === "new" ? "new" : undefined,
    mentionBot: flags["mention-bot"] === true,
    channelId: typeof flags.channel === "string" ? flags.channel : undefined,
  }),
});
console.log(await response.text());
process.exit(response.ok ? 0 : 1);
