"use client";

import { IntegrationConnectionsPanel } from "@repo/app/integrations/components/integration-connections-panel";
import { INTEGRATION_CONNECTIONS_ANCHOR } from "@repo/app/integrations/lib/integration-anchors";
import { Header } from "../../components/header";

const CONNECTIONS_BREADCRUMBS = [{ label: "Connections" }];

type ConnectionsPageClientProps = {
  isAdmin: boolean;
};

export function ConnectionsPageClient({
  isAdmin,
}: Readonly<ConnectionsPageClientProps>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <IntegrationConnectionsPanel
        id={INTEGRATION_CONNECTIONS_ANCHOR}
        isAdmin={isAdmin}
        renderHeader={(action) => (
          <Header breadcrumbs={CONNECTIONS_BREADCRUMBS}>{action}</Header>
        )}
      />
    </div>
  );
}
