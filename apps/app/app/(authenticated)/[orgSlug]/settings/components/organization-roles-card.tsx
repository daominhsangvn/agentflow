"use client";

import {
  customOrgRoleNameSchema,
  isBuiltInOrgRole,
  ORG_PERMISSION_CATALOGUE,
  type OrgPermission,
  type OrgPermissionCatalogueEntry,
  type OrgPermissionGroup,
  OWNER_ONLY_CAPABILITIES,
} from "@repo/api/src/types/org-permissions";
import { authApi, type OrgRoleRecord } from "@repo/auth/auth-client";
import { errorMessage } from "@repo/auth/components/auth-card";
import {
  Alert,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/design-system/components/ui/alert-dialog";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { Checkbox } from "@repo/design-system/components/ui/checkbox";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { useCallback, useEffect, useState } from "react";

const EMPTY_STATE_TEXT =
  "No custom roles yet. Create a role and choose its permissions.";

type Draft = {
  /** The role being edited, or null when creating. */
  editing: string | null;
  name: string;
  permissions: OrgPermission[];
};

/**
 * Owner-only management of custom organization roles. Built-in roles are never
 * listed here. Mount it only for owners: it loads the roles on mount.
 */
export function OrganizationRolesCard() {
  const [roles, setRoles] = useState<OrgRoleRecord[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await authApi.listRoles();
    if (result.error || !result.data) {
      setError(errorMessage(result.error, "Could not load roles"));
      return;
    }
    setRoles(result.data.filter((item) => !isBuiltInOrgRole(item.role)));
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const save = async () => {
    if (!draft) {
      return;
    }
    setError(null);
    let result: Awaited<ReturnType<typeof authApi.createRole>>;
    if (draft.editing) {
      result = await runBusy(setBusy, () =>
        authApi.updateRole({
          roleName: draft.editing as string,
          data: { permission: draft.permissions },
        })
      );
    } else {
      const parsed = customOrgRoleNameSchema.safeParse(draft.name.trim());
      if (!parsed.success) {
        setError(
          "Use 2 to 32 lowercase letters, digits or dashes, starting with a letter. owner, admin and member are reserved."
        );
        return;
      }
      result = await runBusy(setBusy, () =>
        authApi.createRole({
          role: parsed.data,
          permission: draft.permissions,
        })
      );
    }
    if (result.error) {
      setError(errorMessage(result.error, "Could not save the role"));
      return;
    }
    setDraft(null);
    await load();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }
    const roleName = pendingDelete;
    setPendingDelete(null);
    setError(null);
    const result = await runBusy(setBusy, () =>
      authApi.deleteRole({ roleName })
    );
    if (result.error) {
      setError(errorMessage(result.error, "Could not delete the role"));
      return;
    }
    await load();
  };

  const togglePermission = (permission: OrgPermission, checked: boolean) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const rest = current.permissions.filter((item) => item !== permission);
      return {
        ...current,
        permissions: checked ? [...rest, permission] : rest,
      };
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
        <CardDescription>
          Custom roles grant a chosen set of permissions. owner, admin and
          member are built in and cannot be changed here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="text-muted-foreground text-sm">
          <p>Only an owner can:</p>
          <ul className="list-disc pl-5">
            {OWNER_ONLY_CAPABILITIES.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </div>
        {roles.length === 0 && !draft && (
          <p className="text-muted-foreground text-sm">{EMPTY_STATE_TEXT}</p>
        )}
        <ul className="space-y-2">
          {roles.map((role) => (
            <li
              className="flex items-center justify-between rounded-md border p-3"
              key={role.id}
            >
              <div>
                <p className="font-medium text-sm">{role.role}</p>
                <p className="text-muted-foreground text-xs">
                  {role.permissions.length} permission
                  {role.permissions.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      editing: role.role,
                      name: role.role,
                      permissions: role.permissions,
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  Edit
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setPendingDelete(role.role)}
                  size="sm"
                  variant="outline"
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {draft ? (
          <RoleForm
            busy={busy}
            draft={draft}
            onCancel={() => setDraft(null)}
            onName={(name) => setDraft({ ...draft, name })}
            onSave={save}
            onToggle={togglePermission}
          />
        ) : (
          <Button
            onClick={() =>
              setDraft({ editing: null, name: "", permissions: [] })
            }
            size="sm"
          >
            Create role
          </Button>
        )}
      </CardContent>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
        open={pendingDelete !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role {pendingDelete}?</AlertDialogTitle>
            <AlertDialogDescription>
              A role that is still assigned to members cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

type RoleFormProperties = {
  busy: boolean;
  draft: Draft;
  onCancel: () => void;
  onName: (name: string) => void;
  onSave: () => void;
  onToggle: (permission: OrgPermission, checked: boolean) => void;
};

function RoleForm({
  busy,
  draft,
  onCancel,
  onName,
  onSave,
  onToggle,
}: Readonly<RoleFormProperties>) {
  const groups = groupCatalogue();
  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-1">
        <Label htmlFor="custom-role-name">Role name</Label>
        <Input
          disabled={draft.editing !== null}
          id="custom-role-name"
          onChange={(event) => onName(event.target.value)}
          placeholder="reviewer"
          value={draft.name}
        />
      </div>
      {groups.map(([group, entries]) => (
        <fieldset className="space-y-2" key={group}>
          <legend className="font-medium text-sm capitalize">{group}</legend>
          {entries.map((entry) => {
            const id = `role-permission-${entry.permission}`;
            return (
              <div className="flex items-start gap-2" key={entry.permission}>
                <Checkbox
                  checked={draft.permissions.includes(entry.permission)}
                  id={id}
                  onCheckedChange={(checked) =>
                    onToggle(entry.permission, checked === true)
                  }
                />
                <Label className="flex flex-col items-start gap-0" htmlFor={id}>
                  <span>{entry.label}</span>
                  <span className="font-normal text-muted-foreground text-xs">
                    {entry.description}
                  </span>
                </Label>
              </div>
            );
          })}
        </fieldset>
      ))}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={onSave} size="sm">
          Save role
        </Button>
        <Button disabled={busy} onClick={onCancel} size="sm" variant="outline">
          Cancel
        </Button>
      </div>
    </div>
  );
}

async function runBusy<T>(
  setBusy: (busy: boolean) => void,
  action: () => Promise<T>
): Promise<T> {
  setBusy(true);
  try {
    return await action();
  } finally {
    setBusy(false);
  }
}

type CatalogueGroup = [OrgPermissionGroup, OrgPermissionCatalogueEntry[]];

function groupCatalogue(): CatalogueGroup[] {
  const groups = new Map<OrgPermissionGroup, OrgPermissionCatalogueEntry[]>();
  for (const entry of ORG_PERMISSION_CATALOGUE) {
    const list = groups.get(entry.group) ?? [];
    list.push(entry);
    groups.set(entry.group, list);
  }
  return [...groups.entries()];
}
