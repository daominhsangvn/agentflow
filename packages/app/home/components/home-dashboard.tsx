"use client";

import { AttentionWidget } from "./home-attention-widget";
import {
  AgentsWidget,
  CasesWidget,
  ProjectsWidget,
  SessionsWidget,
  WorkflowsWidget,
} from "./home-count-widgets";
import { UsageWidget } from "./home-usage-widget";

export function HomeDashboard() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div className="md:col-span-2">
        <AttentionWidget />
      </div>
      <CasesWidget />
      <AgentsWidget />
      <div className="md:col-span-2">
        <UsageWidget />
      </div>
      <WorkflowsWidget />
      <ProjectsWidget />
      <SessionsWidget />
    </div>
  );
}
