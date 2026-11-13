import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { auth } from "@repo/auth/server";
import { SettingsPage } from "./components/settings-page";
import {
  ADMIN_SETTINGS_TABS,
  BASE_SETTINGS_TABS,
  DEFAULT_SETTINGS_TAB,
  SETTINGS_INTEGRATION_CALLBACK_PARAMS,
  type SettingsIntegrationCallbackParam,
  SettingsTab,
} from "./settings-tabs";

// The callback keys are derived from the shared const rather than re-listed, so
// adding one to `SETTINGS_INTEGRATION_CALLBACK_PARAMS` teaches this page's
// searchParams type and its detection in the same edit.
export type SettingsPageProperties = {
  searchParams: Promise<
    { tab?: string | string[] } & Partial<
      Record<SettingsIntegrationCallbackParam, string | string[]>
    >
  >;
};

export default async function Page({
  searchParams,
}: Readonly<SettingsPageProperties>) {
  const [{ has }, params] = await Promise.all([auth(), searchParams]);
  const isAdmin = has({ permission: OrgPermission.OrganizationUpdate });
  const canManageCustomFields = has({
    permission: OrgPermission.CustomFieldManage,
  });
  const canManageCatalog = has({ permission: OrgPermission.CatalogManage });
  const requestedTab = getRequestedTab(params.tab);
  const allowedTabs = [
    ...BASE_SETTINGS_TABS,
    ...ADMIN_SETTINGS_TABS.filter((tab) =>
      isAdminTabAllowed(tab, { canManageCatalog, canManageCustomFields })
    ),
  ];
  // Any integration OAuth callback (github / google / linear) returns the
  // admin to /settings with a status query param. Force the integrations
  // tab so the relevant card is mounted to surface the updated status,
  // toast, or (PLN-634) the different-account confirmation dialog —
  // otherwise the admin lands on the default `profile` tab and misses it.
  const isIntegrationCallback = SETTINGS_INTEGRATION_CALLBACK_PARAMS.some(
    (key) => hasSearchParamValue(params[key])
  );
  const initialTab = resolveInitialTab({
    isIntegrationCallback,
    requestedTab,
    allowedTabs,
  });

  return (
    <SettingsPage
      canManageCatalog={canManageCatalog}
      canManageCustomFields={canManageCustomFields}
      initialTab={initialTab}
      isAdmin={isAdmin}
    />
  );
}

function getRequestedTab(tab: string | string[] | undefined): string | null {
  if (typeof tab === "string") {
    return tab;
  }

  if (Array.isArray(tab)) {
    return tab[0] ?? null;
  }

  return null;
}

function resolveInitialTab(input: {
  isIntegrationCallback: boolean;
  requestedTab: string | null;
  allowedTabs: readonly string[];
}): string {
  if (input.isIntegrationCallback) {
    return SettingsTab.Integrations;
  }
  if (input.requestedTab && input.allowedTabs.includes(input.requestedTab)) {
    return input.requestedTab;
  }
  return DEFAULT_SETTINGS_TAB;
}

/**
 * Whether a callback query key carries a real value.
 *
 * Repeated params arrive as an array, and an empty string is not a callback —
 * only a nonempty value means an OAuth round trip actually happened and should
 * outrank an explicit `?tab=`.
 */
function hasSearchParamValue(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => entry.length > 0);
  }
  return Boolean(value);
}

function isAdminTabAllowed(
  tab: SettingsTab,
  can: { canManageCatalog: boolean; canManageCustomFields: boolean }
): boolean {
  if (tab === SettingsTab.CustomFields) {
    return can.canManageCustomFields;
  }

  if (tab === SettingsTab.Compliance) {
    return can.canManageCatalog;
  }

  return false;
}
