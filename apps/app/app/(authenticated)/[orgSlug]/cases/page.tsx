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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <OrgCaseList layout="page" />
      </div>
    </div>
  );
}
