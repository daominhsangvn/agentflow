"use client";

import { HomeDashboard } from "@repo/app/home/components/home-dashboard";
import { Header } from "@/app/(authenticated)/components/header";
import { AgentOnboardingCard } from "../../components/agent-onboarding-card";
import { OnboardingChecklist } from "../../components/onboarding-checklist";

/**
 * Home: the org landing page, served at the `/dashboard` URL. It shows org
 * statistics widgets (projects, workflows, cases, agents, sessions, usage and
 * attention), each with its own query and loading / error / empty state. The
 * session-telemetry `InsightsOverviewDashboard` is no longer mounted by the
 * web app (user decision); the component stays in `packages/app` for desktop.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header breadcrumbs={[{ label: "Home" }]} suppressPageHeading />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Home</h1>
          <p className="text-muted-foreground">
            Your projects, workflows, cases and agents at a glance.
          </p>
        </div>
        <OnboardingChecklist />
        <AgentOnboardingCard />
        <HomeDashboard />
      </div>
    </div>
  );
}
