import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { auth } from "@repo/auth/server";
import type { Metadata } from "next";
import { ConnectionsPageClient } from "./connections-page-client";

export const metadata: Metadata = {
  title: "Connections",
  description: "Integration connections your projects and workflows use",
};

export default async function ConnectionsPage() {
  const { has } = await auth();
  const isAdmin = has({ permission: OrgPermission.IntegrationManage });

  return <ConnectionsPageClient isAdmin={isAdmin} />;
}
