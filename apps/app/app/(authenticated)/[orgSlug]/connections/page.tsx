import { auth } from "@repo/auth/server";
import type { Metadata } from "next";
import { Header } from "../../components/header";
import { ConnectionsPageClient } from "./connections-page-client";

export const metadata: Metadata = {
  title: "Connections",
  description: "Integration connections your projects and workflows use",
};

export default async function ConnectionsPage() {
  const { has } = await auth();
  const isAdmin = has({ role: "org:admin" }) || has({ role: "org:owner" });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header breadcrumbs={[{ label: "Connections" }]} />
      <div className="flex-1 overflow-auto">
        <ConnectionsPageClient isAdmin={isAdmin} />
      </div>
    </div>
  );
}
