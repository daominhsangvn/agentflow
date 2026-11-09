import { normalizeAgentSlug } from "@repo/app/agents/lib/agent-slug-label";
import { AgentDetailView } from "@repo/app/compute/components/agent-detail-view";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Header } from "../../../components/header";

type AgentDetailPageProps = {
  params: Promise<{ orgSlug: string; agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: "Agent",
  description: "Health, capabilities and recent work of an agent",
};

export default async function AgentDetailPage({
  params,
  searchParams,
}: AgentDetailPageProps) {
  const { orgSlug, agentId } = await params;

  // The catalog used to live at /agents/<slug>; those links land on /skills.
  if (!z.uuid().safeParse(agentId).success) {
    const query = serializeSearchParams(await searchParams);
    redirect(
      `/${orgSlug}/skills/${encodeURIComponent(normalizeAgentSlug(agentId))}${query}`
    );
  }

  return (
    <>
      <Header
        breadcrumbs={[
          { href: `/${orgSlug}/agents`, label: "Agents" },
          { label: "Agent" },
        ]}
      />
      {/* plain <div>, not <main>: the shell's SidebarInset owns the page's single main landmark. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
        <AgentDetailView
          agentId={agentId}
          notFoundHref={`/${orgSlug}/skills/${agentId}`}
        />
      </div>
    </>
  );
}

function serializeSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) {
        query.append(key, item);
      }
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}
