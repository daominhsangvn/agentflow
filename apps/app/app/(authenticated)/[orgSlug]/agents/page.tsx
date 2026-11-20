import { AgentFleetTable } from "@repo/app/compute/components/agent-fleet-table";
import { Button } from "@repo/design-system/components/ui/button";
import { Link } from "@repo/navigation/link";
import type { Metadata } from "next";
import { Header } from "../../components/header";
import { LocalComputeTargetsCard } from "../settings/components/local-compute-targets-card";

export const metadata: Metadata = {
  title: "Agents",
  description: "The agents that run your organization's work",
};

type AgentsPageProps = {
  params: Promise<{ orgSlug: string }>;
};

export default async function AgentsPage({
  params,
}: Readonly<AgentsPageProps>) {
  const { orgSlug } = await params;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header breadcrumbs={[{ label: "Agents" }]}>
        <Button asChild size="sm" variant="outline">
          <Link href={`/${orgSlug}/settings?tab=api-keys`}>Create API key</Link>
        </Button>
      </Header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-6">
        <p className="max-w-2xl text-muted-foreground text-sm">
          The computers that run your agents: automatic agents and personal
          agents.
        </p>
        <AgentFleetTable />
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-lg">Your agents</h2>
          <LocalComputeTargetsCard />
        </section>
      </div>
    </div>
  );
}
