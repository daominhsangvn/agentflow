import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Signed token carried by the invitation link (A25). Invitation ids are visible
 * to every organization member, so the id alone proves nothing; the token is
 * an HMAC of the id that only the emailed link holds.
 */

const TOKEN_PREFIX = "agentflow:invitation:v1:";

const tokenSchema = z.string().min(1);

export function invitationToken(
  invitationId: string,
  secret: string = authSecret()
): string {
  return createHmac("sha256", secret)
    .update(`${TOKEN_PREFIX}${invitationId}`)
    .digest("base64url");
}

export function isValidInvitationToken(
  invitationId: string,
  token: unknown,
  secret: string = authSecret()
): boolean {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) {
    return false;
  }
  const actual = Buffer.from(parsed.data);
  const expected = Buffer.from(invitationToken(invitationId, secret));
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required to sign invitation links");
  }
  return secret;
}
