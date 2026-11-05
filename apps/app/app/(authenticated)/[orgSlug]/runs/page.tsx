import { OrgRunsView } from "@repo/app/workflows/components/org-runs-view";
import type { Metadata } from "next";
import { Header } from "../../components/header";

const RUNS_BREADCRUMBS = [{ label: "Runs" }];

export const metadata: Metadata = {
  title: "Runs",
  description: "Runs of process-mode workflows across your projects",
};

/** Org-wide runs of process-mode workflows. */
export default function RunsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header breadcrumbs={RUNS_BREADCRUMBS} />
      {/* plain div, not main: the shell's SidebarInset owns the single main landmark. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        <p className="text-muted-foreground text-sm">
          Runs of process-mode workflows across your projects.
        </p>
        <OrgRunsView />
      </div>
    </div>
  );
}
