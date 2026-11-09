import { OrgCaseList } from "@repo/app/orchestrator/components/org-case-list";
import type { Metadata } from "next";
import { Header } from "../../components/header";

const CASES_BREADCRUMBS = [{ label: "Cases" }];

export const metadata: Metadata = {
  title: "Cases",
  description: "Every orchestrator case across your workflows",
};

/** Org-wide orchestrator cases. */
export default function CasesPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header breadcrumbs={CASES_BREADCRUMBS} />
      {/* plain div, not main: the shell's SidebarInset owns the single main landmark. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        <p className="text-muted-foreground text-sm">
          Every orchestrator case across your workflows.
        </p>
        <OrgCaseList />
      </div>
    </div>
  );
}
