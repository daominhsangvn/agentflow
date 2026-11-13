import type { APIRequestContext } from "@playwright/test";
import { z } from "zod";
import { pollUntil } from "./poll";

/** Mailpit REST API (docker-compose dev stack; SMTP_URL points the api at it). */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";
const MAIL_WAIT_MS = 20_000;
const INVITATION_LINK = /https?:\/\/[^\s"'<>]*\/invitations\/[^\s"'<>]+/;

const messageListSchema = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      To: z.array(z.object({ Address: z.string() })),
    })
  ),
});

const messageSchema = z.object({ Text: z.string().default("") });

/**
 * Waits for the invitation email to `email` and returns the `/invitations/<id>`
 * URL from its body.
 */
export async function waitForInvitationLink(
  request: APIRequestContext,
  email: string
): Promise<string> {
  return await pollUntil(
    async () => {
      const list = await request.get(`${MAILPIT_URL}/api/v1/messages`);
      if (!list.ok()) {
        return null;
      }
      const { messages } = messageListSchema.parse(await list.json());
      for (const message of messages) {
        if (!message.To.some((to) => to.Address === email)) {
          continue;
        }
        const detail = await request.get(
          `${MAILPIT_URL}/api/v1/message/${message.ID}`
        );
        const { Text } = messageSchema.parse(await detail.json());
        const link = INVITATION_LINK.exec(Text);
        if (link) {
          return link[0];
        }
      }
      return null;
    },
    {
      description: `an invitation email to ${email} in Mailpit (${MAILPIT_URL})`,
      timeoutMs: MAIL_WAIT_MS,
    }
  );
}
