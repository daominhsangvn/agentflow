"use client";

import { IntegrationConnectionsSection } from "../settings/components/integration-connections-section";

type ConnectionsPageClientProps = {
  isAdmin: boolean;
};

export function ConnectionsPageClient({
  isAdmin,
}: Readonly<ConnectionsPageClientProps>) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
      <p className="text-muted-foreground text-sm">
        Jira, Azure DevOps, Microsoft Teams, Bitbucket and HTTPS connections
        your projects and workflows use.
      </p>
      <IntegrationConnectionsSection isAdmin={isAdmin} />
    </div>
  );
}
