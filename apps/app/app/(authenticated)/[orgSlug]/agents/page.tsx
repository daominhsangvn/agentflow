import { AgentFleetTable } from "@repo/app/compute/components/agent-fleet-table";
import type { Metadata } from "next";
import { Header } from "../../components/header";
import { LocalComputeTargetsCard } from "../settings/components/local-compute-targets-card";

export const metadata: Metadata = {
  title: "Agents",
  description: "The agents that run your organization's work",
};

export default function AgentsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header breadcrumbs={[{ label: "Agents" }]} />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
        <p className="text-muted-foreground text-sm">
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
