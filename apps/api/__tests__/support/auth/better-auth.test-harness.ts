import type { BetterAuthOptions } from "better-auth";
import { organization } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { ac, orgRoles } from "@/lib/auth/access-control";
import { agentflowAuthPlugin } from "@/lib/auth/agentflow-auth-plugin";

/**
 * A real Better Auth instance (in-memory node:sqlite, real migrations) with
 * the AgentFlow organization and plugin configuration, driven over HTTP
 * through `auth.handler`. Nothing of Better Auth is mocked.
 */

export const TEST_PASSWORD = "test-password-123";

export type SentInvitation = { id: string; email: string };

export type AuthResponse = {
  status: number;
  data: unknown;
  code: string | undefined;
};

export type AuthTestInstance = Pick<
  Awaited<ReturnType<typeof getTestInstance>>,
  "db" | "signInWithUser" | "sessionSetter"
> & {
  sentInvitations: SentInvitation[];
  signUp(email: string): Promise<{ userId: string; headers: Headers }>;
  createOrg(headers: Headers, slug: string): Promise<{ id: string }>;
  post(
    path: string,
    headers: Headers,
    body: Record<string, unknown>
  ): Promise<AuthResponse>;
  get(
    path: string,
    headers: Headers,
    query?: Record<string, string>
  ): Promise<AuthResponse>;
  invite(
    headers: Headers,
    body: Record<string, unknown>
  ): Promise<AuthResponse>;
  /** Server-side add (add-member has no HTTP route); returns the member id. */
  addMember(
    organizationId: string,
    userId: string,
    role: string
  ): Promise<string>;
};

export async function createAuthTestInstance(
  extra: Partial<BetterAuthOptions> = {}
): Promise<AuthTestInstance> {
  const sentInvitations: SentInvitation[] = [];
  const { plugins: extraPlugins, ...restExtra } = extra;
  const instance = await getTestInstance(
    {
      ...restExtra,
      plugins: [
        organization({
          ac,
          roles: orgRoles,
          dynamicAccessControl: { enabled: true },
          requireEmailVerificationOnInvitation: false,
          sendInvitationEmail: (data) => {
            sentInvitations.push({ id: data.id, email: data.email });
            return Promise.resolve();
          },
        }),
        agentflowAuthPlugin(),
        ...(extraPlugins ?? []),
      ],
    },
    { disableTestUser: true }
  );
  const { client, auth, signInWithUser } = instance;

  async function signUp(email: string): Promise<{
    userId: string;
    headers: Headers;
  }> {
    const created = await auth.api.signUpEmail({
      body: { email, password: TEST_PASSWORD, name: email.split("@")[0] },
    });
    const { headers } = await signInWithUser(email, TEST_PASSWORD);
    return { userId: created.user.id, headers };
  }

  async function createOrg(
    headers: Headers,
    slug: string
  ): Promise<{ id: string }> {
    const created = await auth.api.createOrganization({
      headers,
      body: { name: slug, slug },
    });
    if (!created) {
      throw new Error("organization was not created");
    }
    return { id: created.id };
  }

  async function post(
    path: string,
    headers: Headers,
    body: Record<string, unknown>
  ): Promise<AuthResponse> {
    const res = await client.$fetch(path, { method: "POST", headers, body });
    return toResponse(res);
  }

  async function get(
    path: string,
    headers: Headers,
    query: Record<string, string> = {}
  ): Promise<AuthResponse> {
    const res = await client.$fetch(path, { method: "GET", headers, query });
    return toResponse(res);
  }

  function invite(
    headers: Headers,
    body: Record<string, unknown>
  ): Promise<AuthResponse> {
    return post("/organization/invite-member", headers, body);
  }

  async function addMember(
    organizationId: string,
    userId: string,
    role: string
  ): Promise<string> {
    const member = await instance.db.create<{ id: string }>({
      model: "member",
      data: { organizationId, userId, role, createdAt: new Date() },
    });
    return member.id;
  }

  return {
    addMember,
    db: instance.db,
    signInWithUser,
    sessionSetter: instance.sessionSetter,
    sentInvitations,
    signUp,
    createOrg,
    post,
    get,
    invite,
  };
}

function toResponse(res: {
  data: unknown;
  error: { status?: number; code?: string } | null;
}): AuthResponse {
  if (res.error) {
    return {
      status: res.error.status ?? 0,
      data: null,
      code: res.error.code,
    };
  }
  return { status: 200, data: res.data, code: undefined };
}
