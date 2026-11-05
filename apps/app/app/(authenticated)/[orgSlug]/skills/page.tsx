import type { Metadata } from "next";
import { Header } from "../../components/header";
import { AgentsGroupedListContainer } from "./components/agents-grouped-list-container";

export const metadata: Metadata = {
  title: "Skills catalog",
  description: "Browse the agent components available to your organization",
};

export default function SkillsCatalogPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header breadcrumbs={[{ label: "Skills catalog" }]} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AgentsGroupedListContainer />
      </div>
    </div>
  );
}
