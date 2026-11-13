"use client";

import {
  BUILT_IN_ROLE_PERMISSIONS,
  BuiltInOrgRole,
  canAssignOrgRole,
  isBuiltInOrgRole,
  OrgPermission,
  parseOrgPermission,
  splitOrgRoleNames,
} from "@repo/api/src/types/org-permissions";
import {
  Alert,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type AuthResult,
  type AuthRoleName,
  authApi,
  type FullOrganization,
  type OrgRoleRecord,
  refreshSession,
  useSessionSnapshot,
} from "../auth-client";
import { errorMessage } from "./auth-card";

const OWNER_ORG_ROLE = `org:${BuiltInOrgRole.Owner}`;

type MemberRow = FullOrganization["members"][number];
type InvitationRow = FullOrganization["invitations"][number];

/**
 * Organization settings: members, roles and invitations. Owners and admins can
 * invite, change roles and remove members; everyone else sees the roster.
 */
export function OrganizationProfile(_props: Readonly<Record<string, unknown>>) {
  const session = useSessionSnapshot();
  const callerIsOwner = session.claims?.org_role === OWNER_ORG_ROLE;
  const permissions = new Set(session.claims?.org_permissions ?? []);
  const callerPermissions = parseCallerPermissions(
    session.claims?.org_permissions
  );
  const can = (permission: OrgPermission) =>
    callerIsOwner || permissions.has(permission);
  const canInvite = can(OrgPermission.InvitationCreate);
  const canRevoke = can(OrgPermission.InvitationCancel);
  const canChangeRoles = can(OrgPermission.MemberUpdate);
  const canRemove = can(OrgPermission.MemberDelete);
  const canRename = can(OrgPermission.OrganizationUpdate);
  const needsRoles = canChangeRoles || canInvite;
  const currentUserId = session.claims?.sub ?? null;
  const [name, setName] = useState("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AuthRoleName>(
    BuiltInOrgRole.Member
  );
  const [customRoles, setCustomRoles] = useState<OrgRoleRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await authApi.getFullOrganization();
    if (result.error || !result.data) {
      setError(errorMessage(result.error, "Could not load the organization"));
      return;
    }
    setName(result.data.name);
    setMembers(result.data.members);
    setInvitations(
      result.data.invitations.filter((i) => i.status === "pending")
    );
  }, []);

  useEffect(() => {
    if (session.status === "signed-in") {
      load().catch(() => undefined);
    }
  }, [session.status, load]);

  useEffect(() => {
    if (session.status !== "signed-in" || !needsRoles) {
      return;
    }
    authApi
      .listRoles()
      .then((result) => setCustomRoles(result.data ?? []))
      .catch(() => undefined);
  }, [session.status, needsRoles]);

  const roles = roleOptions({
    callerIsOwner,
    callerPermissions,
    customRoles,
  });

  const run = async (action: () => Promise<AuthResult>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.error) {
      setError(errorMessage(result.error, "The change was not saved"));
      return;
    }
    await load();
  };

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(async () => {
      const result = await authApi.updateOrganization({ name });
      await refreshSession();
      return result;
    }).catch(() => undefined);
  };

  const invite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(async () => {
      const result = await authApi.inviteMember({
        email: inviteEmail,
        role: inviteRole,
      });
      if (!result.error) {
        setInviteEmail("");
      }
      return result;
    }).catch(() => undefined);
  };

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form className="flex items-end gap-2" onSubmit={rename}>
        <div className="flex-1 space-y-2">
          <Label htmlFor="org-profile-name">Organization name</Label>
          <Input
            disabled={!canRename}
            id="org-profile-name"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </div>
        {canRename ? (
          <Button
            disabled={busy || !name.trim()}
            type="submit"
            variant="outline"
          >
            Save
          </Button>
        ) : null}
      </form>

      <section className="space-y-2">
        <h3 className="font-medium">Members</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              {canRemove ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>{member.user.name}</TableCell>
                <TableCell>{member.user.email}</TableCell>
                <TableCell>
                  {canChangeRoles &&
                  canEditMemberRole({
                    callerIsOwner,
                    callerPermissions,
                    customRoles,
                    memberRole: member.role,
                    isSelf: member.user.id === currentUserId,
                  }) ? (
                    <select
                      aria-label={`Role for ${member.user.email}`}
                      className="rounded border bg-background px-2 py-1 text-sm"
                      disabled={busy}
                      onChange={(event) =>
                        run(() =>
                          authApi.updateMemberRole({
                            memberId: member.id,
                            role: event.target.value,
                          })
                        )
                      }
                      value={member.role}
                    >
                      {withCurrentRole(roles, member.role).map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant="secondary">{member.role}</Badge>
                  )}
                </TableCell>
                {canRemove ? (
                  <TableCell className="text-right">
                    {member.user.id === currentUserId ||
                    (member.role === BuiltInOrgRole.Owner &&
                      !callerIsOwner) ? null : (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run(() => authApi.removeMember(member.id))
                        }
                        size="sm"
                        variant="ghost"
                      >
                        Remove
                      </Button>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      {canInvite || (canRevoke && invitations.length > 0) ? (
        <section className="space-y-2">
          <h3 className="font-medium">
            {canInvite ? "Invite a member" : "Pending invitations"}
          </h3>
          {canInvite ? (
            <form className="flex items-end gap-2" onSubmit={invite}>
              <div className="flex-1 space-y-2">
                <Label htmlFor="org-invite-email">Email</Label>
                <Input
                  id="org-invite-email"
                  onChange={(event) => setInviteEmail(event.target.value)}
                  type="email"
                  value={inviteEmail}
                />
              </div>
              <select
                aria-label="Invited role"
                className="h-9 rounded border bg-background px-2 text-sm"
                onChange={(event) => setInviteRole(event.target.value)}
                value={inviteRole}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <Button disabled={busy || !inviteEmail.trim()} type="submit">
                Invite
              </Button>
            </form>
          ) : null}
          {invitations.length > 0 ? (
            <ul className="space-y-1 text-muted-foreground text-sm">
              {invitations.map((invitation) => (
                <li
                  className="flex items-center justify-between"
                  key={invitation.id}
                >
                  <span>
                    {invitation.email} ·{" "}
                    {invitation.role ?? BuiltInOrgRole.Member} · pending
                  </span>
                  {canRevoke ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(() => authApi.cancelInvitation(invitation.id))
                      }
                      size="sm"
                      variant="ghost"
                    >
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Roles offered in the role pickers: only roles the caller may assign (owner
 * only for the owner; otherwise roles whose permissions the caller all holds).
 */
export function roleOptions(input: {
  callerIsOwner: boolean;
  callerPermissions: ReadonlySet<OrgPermission>;
  customRoles: readonly OrgRoleRecord[];
}): string[] {
  const { callerIsOwner, callerPermissions, customRoles } = input;
  const options: string[] = [];
  if (callerIsOwner) {
    options.push(BuiltInOrgRole.Owner);
  }
  const adminAllowed = canAssignOrgRole({
    callerIsOwner,
    callerPermissions,
    targetRoleNames: [BuiltInOrgRole.Admin],
    targetPermissions: BUILT_IN_ROLE_PERMISSIONS[BuiltInOrgRole.Admin],
  });
  if (adminAllowed) {
    options.push(BuiltInOrgRole.Admin);
  }
  options.push(BuiltInOrgRole.Member);
  for (const custom of customRoles) {
    if (isBuiltInOrgRole(custom.role) || options.includes(custom.role)) {
      continue;
    }
    const allowed = canAssignOrgRole({
      callerIsOwner,
      callerPermissions,
      targetRoleNames: [custom.role],
      targetPermissions: custom.permissions,
    });
    if (allowed) {
      options.push(custom.role);
    }
  }
  return options;
}

/** Whether the caller may change this member's role (never their own). */
export function canEditMemberRole(input: {
  callerIsOwner: boolean;
  callerPermissions: ReadonlySet<OrgPermission>;
  customRoles: readonly OrgRoleRecord[];
  memberRole: string;
  isSelf: boolean;
}): boolean {
  if (input.isSelf) {
    return false;
  }
  if (input.callerIsOwner) {
    return true;
  }
  const names = splitOrgRoleNames(input.memberRole);
  const targetPermissions: OrgPermission[] = [];
  for (const name of names) {
    const builtIn = Object.values(BuiltInOrgRole).find((r) => r === name);
    if (builtIn) {
      targetPermissions.push(...BUILT_IN_ROLE_PERMISSIONS[builtIn]);
      continue;
    }
    const custom = input.customRoles.find((r) => r.role === name);
    if (!custom) {
      return false;
    }
    targetPermissions.push(...custom.permissions);
  }
  return canAssignOrgRole({
    callerIsOwner: false,
    callerPermissions: input.callerPermissions,
    targetRoleNames: names,
    targetPermissions,
  });
}

/** Keeps a member's current role selectable even if it is not in the list. */
function withCurrentRole(
  options: readonly string[],
  current: string
): string[] {
  return options.includes(current) ? [...options] : [...options, current];
}

function parseCallerPermissions(
  values: readonly string[] | undefined
): Set<OrgPermission> {
  const result = new Set<OrgPermission>();
  for (const value of values ?? []) {
    const parsed = parseOrgPermission(value);
    if (parsed) {
      result.add(parsed);
    }
  }
  return result;
}
