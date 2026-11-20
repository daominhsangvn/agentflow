import { WorkflowsIndexView } from "@repo/app/workflows/components/workflows-index-view";
import { Button } from "@repo/design-system/components/ui/button";
import { Link } from "@repo/navigation/link";
import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "../../components/header";
import { resolveWorkflowAdmin } from "./workflow-admin";

const WORKFLOWS_BREADCRUMBS = [{ label: "Workflows" }];

export const metadata: Metadata = {
  title: "Workflows",
  description:
    "Event-driven agent runs started from Jira, Azure DevOps and HTTPS webhooks",
};

/**
 * Workflows index (docs/workflows.md): the org's workflows. The run history
 * lives on /runs (`?tab=runs` redirects there). Always-on: the self-hosted edition has no PostHog, so the route
 * carries no feature-flag gate. Admin capability comes from the session role;
 * members get a read-only view.
 */
type WorkflowsPageProps = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function WorkflowsPage({
  params,
  searchParams,
}: Readonly<WorkflowsPageProps>) {
  const [{ orgSlug }, { tab }] = await Promise.all([params, searchParams]);
  if (tab === "runs") {
    redirect(`/${orgSlug}/runs`);
  }
  const isAdmin = await resolveWorkflowAdmin();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header breadcrumbs={WORKFLOWS_BREADCRUMBS}>
        {isAdmin ? (
          <Button asChild size="sm">
            <Link href={`/${orgSlug}/workflows/new`}>
              <PlusIcon className="size-4" />
              New workflow
            </Link>
          </Button>
        ) : null}
      </Header>
      {/* plain div, not main: the shell's SidebarInset owns the single main landmark. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <WorkflowsIndexView isAdmin={isAdmin} />
      </div>
    </div>
  );
}
