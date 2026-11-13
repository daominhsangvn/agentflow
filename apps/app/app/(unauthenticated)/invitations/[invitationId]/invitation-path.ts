import { INVITATION_TOKEN_PARAM } from "@repo/api/src/types/auth-account";

/** In-app path of the invitation page, carrying the signed link token when present. */
export function invitationPath(
  invitationId: string,
  token: string | null
): string {
  const base = `/invitations/${encodeURIComponent(invitationId)}`;
  if (!token) {
    return base;
  }
  const search = new URLSearchParams({ [INVITATION_TOKEN_PARAM]: token });
  return `${base}?${search.toString()}`;
}
