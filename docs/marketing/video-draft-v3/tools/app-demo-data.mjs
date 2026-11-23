// Demo data for the app screen captures (tools/capture-app.mjs). It tells the same story as the
// video: the LeaveDesk team (BA · Requirements, Engineering · Code, QC · Testing) and the C8 numbers
// (9 projects, 214 workflows, 38 open cases, 21 agents online). Field names follow the apps/api
// responses the pages read; times are relative to the capture, so "5m ago" stays "5m ago".
// demoResponse(pathname, real) returns the body to serve, or undefined to keep the real response.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const demoId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const PROJECTS = [
  "LeaveDesk",
  "Payments",
  "Mobile app",
  "Data platform",
  "Website",
  "HR portal",
  "Support bot",
  "Billing",
  "Internal tools",
];
const projectId = (name) => demoId(100 + PROJECTS.indexOf(name));

// [display name, machine, kind, owner, project, commands, online, enabled workflows, platform]
const AGENTS = [
  ["BA · Requirements", "ba-server-01", "automatic", "Acme", "LeaveDesk", ["/ba-requirement", "/leavedesk-research"], true, 3, "linux"],
  ["Engineering · Code", "khoa-macbook", "personal", "Khoa", "LeaveDesk", ["/writing-plans", "/executing-plans"], true, 3, "darwin"],
  ["QC · Testing", "qa-server-01", "automatic", "Acme", "LeaveDesk", ["/qa-test", "/qa-run"], true, 3, "linux"],
  ["BA · Payments", "pay-ba-01", "automatic", "Acme", "Payments", ["/ba-requirement"], true, 2, "linux"],
  ["Engineering · Payments", "pay-build-02", "automatic", "Acme", "Payments", ["/writing-plans", "/executing-plans"], true, 4, "linux"],
  ["QC · Payments", "pay-qa-01", "automatic", "Acme", "Payments", ["/qa-run"], true, 2, "linux"],
  ["Engineering · Mobile", "mobile-mac-mini", "automatic", "Acme", "Mobile app", ["/executing-plans"], true, 5, "darwin"],
  ["QC · Mobile", "device-lab-02", "automatic", "Acme", "Mobile app", ["/qa-run", "/ui-tests"], true, 3, "darwin"],
  ["Data pipelines", "data-worker-03", "automatic", "Acme", "Data platform", ["/pipeline-fix", "/data-checks"], true, 4, "linux"],
  ["Website · Content", "web-content-01", "automatic", "Acme", "Website", ["/seo-audit", "/a11y-check"], true, 3, "linux"],
  ["HR · Policy Q&A", "hr-ask-01", "automatic", "Acme", "HR portal", ["/ask"], true, 2, "linux"],
  ["Support triage", "support-01", "automatic", "Acme", "Support bot", ["/ticket-triage"], true, 4, "linux"],
  ["Billing · Invoices", "billing-01", "automatic", "Acme", "Billing", ["/invoices", "/nightly-audit"], true, 3, "linux"],
  ["Ops · Access", "ops-tools-01", "automatic", "Acme", "Internal tools", ["/access-requests", "/cleanup"], true, 3, "linux"],
  ["Engineering · Web", "linh-thinkpad", "personal", "Linh", "Website", ["/executing-plans"], true, 1, "win32"],
  ["Engineering · Data", "an-workstation", "personal", "An", "Data platform", ["/executing-plans"], true, 1, "linux"],
  ["QC · Web", "web-qa-01", "automatic", "Acme", "Website", ["/qa-run"], true, 2, "linux"],
  ["Release notes", "release-01", "automatic", "Acme", "Payments", ["/release-notes"], true, 1, "linux"],
  ["Engineering · Support", "support-build-01", "automatic", "Acme", "Support bot", ["/executing-plans"], true, 2, "linux"],
  ["Review helper", "review-01", "automatic", "Acme", "Internal tools", ["/pr-review"], true, 2, "linux"],
  ["Engineering · Billing", "huy-macbook", "personal", "Huy", "Billing", ["/executing-plans"], true, 1, "darwin"],
  ["Engineering · HR", "mai-laptop", "personal", "Mai", "HR portal", ["/executing-plans"], false, 0, "win32"],
].map(([displayName, machineName, kind, ownerName, project, commands, isOnline, enabledWorkflowCount, platform], i) => ({
  id: demoId(200 + i),
  displayName,
  machineName,
  kind,
  ownerName,
  project,
  commands,
  isOnline,
  enabledWorkflowCount,
  platform,
  lastSeen: isOnline ? ago(20_000 + i * 3000) : ago(3 * HOUR),
}));

const ATTENTION = [
  ["waiting_for_human", "LD-12: Export the leave report to CSV", null, "LeaveDesk", "Delivery", 5 * MIN],
  ["pending_decision", "PAY-7: Release notes for v2.4", null, "Payments", "Release notes", 12 * MIN],
  ["waiting_for_human", "DATA-5: Fix the nightly sync pipeline", null, "Data platform", "Pipeline fix", 26 * MIN],
  ["blocked_task", "MOB-33: UI tests for the leave calendar", "/qa-run", "Mobile app", "UI tests", HOUR],
];

const TOP_CASES = ["LD-6: Team leave calendar", "PAY-41: Refund webhook retries", "MOB-30: Offline mode for requests", "DATA-2: Nightly sync to the warehouse"];
const TOP_WORKFLOWS = ["Delivery", "Ticket triage", "Nightly audit", "UI tests"];

function ok(data) {
  return { success: true, data };
}

// Token totals for 7 and 30 days, and the top lists (which sit beside them, not inside).
function usage() {
  const tokens = (i, n) => Math.round(n - i * 0.17 * n);
  const named = (names, base) =>
    names.map((name, i) => ({
      id: demoId(300 + base + i),
      name,
      inputTokens: tokens(i, 9_400_000),
      outputTokens: tokens(i, 1_300_000),
      costUsd: 0,
    }));
  const total = (scale) => ({
    inputTokens: Math.round(48_600_000 * scale),
    outputTokens: Math.round(6_900_000 * scale),
    costUsd: 0,
  });
  return {
    last7d: total(1),
    last30d: total(4.1),
    topCases: named(TOP_CASES, 0),
    topWorkflows: named(TOP_WORKFLOWS, 10),
    topProjects: named(PROJECTS.slice(0, 4), 20),
    topAgents: AGENTS.slice(0, 4).map((a, i) => ({
      id: a.id,
      name: a.displayName,
      inputTokens: tokens(i, 7_800_000),
      outputTokens: tokens(i, 950_000),
      costUsd: 0,
    })),
  };
}

// 30 days ending today: weekdays busier than weekends, a slow climb over the month.
function activityDays() {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const level = (weekend ? 0.35 : 1) * (0.75 + (29 - i) * 0.012) * (1 + 0.08 * Math.sin(i * 1.7));
    const sessions = Math.round(170 * level);
    days.push({
      day: d.toISOString().slice(0, 10),
      sessions,
      inputTokens: sessions * 38_000,
      outputTokens: sessions * 5_200,
      costUsd: 0,
      runsSucceeded: Math.round(sessions * 0.62),
      runsFailed: Math.round(sessions * 0.02),
      runsCancelled: weekend ? 0 : 1,
      casesOpened: Math.round(sessions * 0.11),
      casesClosed: Math.round(sessions * 0.1),
    });
  }
  return days;
}

function fleetAgent(a) {
  return {
    id: a.id,
    machineName: a.machineName,
    displayName: a.displayName,
    kind: a.kind,
    ownerName: a.ownerName,
    isSharedWithOrg: a.kind === "automatic",
    isOnline: a.isOnline,
    lastSeen: a.lastSeen,
    health: a.isOnline ? { healthChecked: ago(2 * HOUR), allRequiredPassed: true, requiredFailureCount: 0 } : null,
    claudeCode: { reported: "2.1.322", pinned: "latest", status: "latest" },
    projects: [{ id: projectId(a.project), name: a.project, commands: a.commands, problemCount: 0 }],
    enabledWorkflowCount: a.enabledWorkflowCount,
  };
}

// The compute-target list carries many machine fields; keep the real item's fields and swap the
// identity, so the page gets every field it expects without any real machine showing.
function computeTargets(real) {
  const template = real?.data?.[0];
  if (!template) {
    return undefined;
  }
  return ok(
    AGENTS.map((a) => ({
      ...template,
      id: a.id,
      machineName: a.machineName,
      displayName: a.displayName,
      platform: a.platform,
      isOnline: a.isOnline,
      lastSeen: a.lastSeen,
    }))
  );
}

// Workflows across the projects. Trigger types are only ones the product has (Jira, Teams, Azure
// DevOps): no email or schedule starts, which the app does not offer yet.
// [project, name, description, trigger types, runs succeeded, failed, active, open cases, needs person]
const WORKFLOWS = [
  ["LeaveDesk", "Delivery", "Requirements → plan → code → tests → review", ["jira.issue_status_changed", "microsoft_teams.bot_mentioned"], 148, 3, 2, 3, 1],
  ["LeaveDesk", "Bug triage", "Reproduce, label and route new bugs", ["jira.issue_labeled"], 96, 1, 0, 1, 0],
  ["Payments", "Delivery", "Requirements → plan → code → tests → review", ["jira.issue_assigned"], 121, 4, 1, 4, 0],
  ["Payments", "Release notes", "Draft release notes from merged work", ["jira.issue_status_changed"], 38, 0, 0, 1, 1],
  ["Mobile app", "UI tests", "Run device tests and report failures", ["azure_devops.work_item_tagged"], 210, 6, 1, 2, 0],
  ["Mobile app", "Crash triage", "Group crashes and open work items", ["azure_devops.work_item_assigned"], 77, 2, 0, 1, 0],
  ["Data platform", "Pipeline fix", "Find and fix failing pipeline steps", ["jira.issue_labeled"], 64, 3, 0, 2, 1],
  ["Website", "SEO audit", "Check pages and open fixes", ["jira.issue_labeled"], 52, 1, 0, 0, 0],
  ["HR portal", "Policy Q&A", "Answer policy questions in Teams", ["microsoft_teams.bot_mentioned"], 233, 2, 1, 0, 0],
  ["Support bot", "Ticket triage", "Classify tickets and suggest replies", ["jira.issue_assigned", "microsoft_teams.bot_mentioned"], 187, 4, 2, 3, 0],
  ["Billing", "Invoice checks", "Check invoice changes before release", ["jira.issue_status_changed"], 45, 1, 0, 1, 0],
  ["Internal tools", "Access requests", "Review and apply access requests", ["jira.issue_conditions"], 119, 0, 0, 0, 0],
];

function workflows(real) {
  const template = real?.data?.workflows?.[0];
  if (!template) {
    return undefined;
  }
  const triggerTemplate = template.triggers?.[0] ?? {};
  return ok({
    ...real.data,
    workflows: WORKFLOWS.map(([project, name, description, types, succeeded, failed, active, open, needsPerson], i) => {
      const id = demoId(500 + i);
      return {
        ...template,
        id,
        name,
        description,
        enabled: true,
        project: { id: projectId(project), name: project },
        runAsUser: { id: demoId(90), name: "Acme Ops", email: "ops@acme.example" },
        agent: { ...template.agent, computeTargetId: AGENTS[0].id, instructions: "", runners: [] },
        triggers: types.map((type, t) => ({
          ...triggerTemplate,
          id: demoId(600 + i * 4 + t),
          projectId: projectId(project),
          type,
          config: {},
          enabled: true,
          position: t,
        })),
        actions: [],
        runCounts: { total: succeeded + failed + active, active, succeeded, failed },
        lastRunAt: ago((i + 1) * 7 * MIN),
        caseCounts: { total: open + succeeded, open, closed: succeeded, lastActivityAt: ago((i + 1) * 5 * MIN), needsPerson },
        createdAt: ago(60 * DAY),
        updatedAt: ago(2 * DAY),
      };
    }),
  });
}

// [status, workflow, project, trigger type, provider, key, title, minutes ago, pull request]
const RUNS = [
  ["running", "Delivery", "LeaveDesk", "jira.issue_status_changed", "jira", "LD-14", "Add public holidays to the calendar", 3, null],
  ["running", "Ticket triage", "Support bot", "microsoft_teams.bot_mentioned", "microsoft_teams", "teams-8c41d2e7a0", "Customer can't reset password", 6, null],
  ["needs_input", "Pipeline fix", "Data platform", "jira.issue_labeled", "jira", "DATA-5", "Fix the nightly sync pipeline", 26, null],
  ["succeeded", "Policy Q&A", "HR portal", "microsoft_teams.bot_mentioned", "microsoft_teams", "teams-4f1c2a9e01", "How many leave days carry over?", 34, null],
  ["succeeded", "UI tests", "Mobile app", "azure_devops.work_item_tagged", "azure_devops", "4512", "Leave form on small screens", 41, null],
  ["succeeded", "Delivery", "Payments", "jira.issue_assigned", "jira", "PAY-41", "Refund webhook retries", 55, ["acme/payments-api", 212]],
  ["succeeded", "Crash triage", "Mobile app", "azure_devops.work_item_assigned", "azure_devops", "4498", "Crash when opening a request offline", 72, null],
  ["failed", "SEO audit", "Website", "jira.issue_labeled", "jira", "WEB-12", "Broken links on the pricing page", 88, null],
  ["succeeded", "Delivery", "LeaveDesk", "jira.issue_status_changed", "jira", "LD-6", "Team leave calendar", 95, ["acme/leavedesk-app", 6]],
  ["succeeded", "Access requests", "Internal tools", "jira.issue_conditions", "jira", "OPS-310", "Grant Mai access to the HR portal", 110, null],
  ["succeeded", "Policy Q&A", "HR portal", "microsoft_teams.bot_mentioned", "microsoft_teams", "teams-2b7e9f0c33", "Is the 2nd of September a holiday?", 126, null],
  ["succeeded", "Invoice checks", "Billing", "jira.issue_status_changed", "jira", "BILL-77", "VAT rounding on credit notes", 140, ["acme/billing", 58]],
  ["succeeded", "Ticket triage", "Support bot", "jira.issue_assigned", "jira", "SUP-903", "Export button missing for managers", 152, null],
  ["succeeded", "Bug triage", "LeaveDesk", "jira.issue_labeled", "jira", "LD-11", "Half-day leave shows as a full day", 171, null],
  ["succeeded", "UI tests", "Mobile app", "azure_devops.work_item_tagged", "azure_devops", "4490", "Dark mode on the calendar", 190, null],
  ["succeeded", "Release notes", "Payments", "jira.issue_status_changed", "jira", "PAY-39", "Release notes for v2.3", 214, null],
  ["failed", "Pipeline fix", "Data platform", "jira.issue_labeled", "jira", "DATA-4", "Late rows in the leave export", 238, null],
  ["succeeded", "Delivery", "Payments", "jira.issue_assigned", "jira", "PAY-40", "Show refund status to customers", 260, ["acme/payments-web", 187]],
  ["succeeded", "Policy Q&A", "HR portal", "microsoft_teams.bot_mentioned", "microsoft_teams", "teams-9a03c5d1e8", "Can I carry over sick days?", 282, null],
  ["succeeded", "Crash triage", "Mobile app", "azure_devops.work_item_assigned", "azure_devops", "4471", "Crash on Android 12 when uploading", 305, null],
].map(([status, workflow, project, triggerType, provider, key, title, minutes, pr], i) => ({ status, workflow, project, triggerType, provider, key, title, minutes, pr, i }));

function sourceUrl(provider, key) {
  if (provider === "jira") {
    return `https://acme.atlassian.net/browse/${key}`;
  }
  if (provider === "azure_devops") {
    return `https://dev.azure.com/acme/mobile/_workitems/edit/${key}`;
  }
  return "https://teams.microsoft.com/";
}

function workflowRuns(real) {
  return ok({
    ...(real?.data ?? {}),
    runs: RUNS.map((r) => {
      const workflowIndex = WORKFLOWS.findIndex(([project, name]) => project === r.project && name === r.workflow);
      const finished = r.status === "succeeded" || r.status === "failed";
      return {
        id: demoId(700 + r.i),
        workflowId: demoId(500 + Math.max(workflowIndex, 0)),
        workflowName: r.workflow,
        triggerId: demoId(600 + Math.max(workflowIndex, 0) * 4),
        triggerType: r.triggerType,
        status: r.status,
        source: { provider: r.provider, externalId: `${r.provider}-${r.key}`, key: r.key, title: r.title, url: sourceUrl(r.provider, r.key) },
        pullRequests: r.pr
          ? [{ url: `https://github.com/${r.pr[0]}/pull/${r.pr[1]}`, number: r.pr[1], repository: r.pr[0], branch: `${r.key.toLowerCase()}-work` }]
          : [],
        error: null,
        createdAt: ago(r.minutes * MIN),
        updatedAt: ago(Math.max(r.minutes - 9, 1) * MIN),
        completedAt: finished ? ago(Math.max(r.minutes - 9, 1) * MIN) : null,
      };
    }),
    nextCursor: null,
  });
}

// Connections keep the real items' fields (the page needs them all) with every account, email and
// URL replaced, so no real workspace shows.
const DEMO_ACCOUNT = "Acme Bot";
function demoConfigValue(value) {
  if (typeof value !== "string") {
    return value;
  }
  if (value.includes("@")) {
    return "agentflow-bot@acme.example";
  }
  if (value.startsWith("http")) {
    if (value.includes("atlassian")) {
      return "https://acme.atlassian.net";
    }
    return value.includes("dev.azure.com") ? "https://dev.azure.com/acme" : "https://acme.example";
  }
  return value;
}

function connections(real) {
  const items = real?.data?.connections;
  if (!Array.isArray(items)) {
    return undefined;
  }
  const usage = { jira: 6, microsoft_teams: 9, azure_devops: 3 };
  return ok({
    ...real.data,
    connections: items.map((c, i) => ({
      ...c,
      id: demoId(800 + i),
      config: Object.fromEntries(Object.entries(c.config ?? {}).map(([k, v]) => [k, demoConfigValue(v)])),
      account: c.account ? { ...c.account, externalAccountId: `demo-${i}`, displayName: DEMO_ACCOUNT } : c.account,
      lastPolledAt: c.lastPolledAt ? ago(40_000) : c.lastPolledAt,
      lastDeliveryAt: ago((2 + i * 3) * MIN),
      lastValidatedAt: ago(3 * DAY),
      lastError: null,
      usageCount: usage[c.provider] ?? 4,
    })),
  });
}

const HANDLERS = {
  "/workflows": (real) => workflows(real),
  "/workflow-runs": (real) => workflowRuns(real),
  "/workflow-runs/summary": () => ok({ total: 1284, active: 7, needsYou: 2, succeeded: 1211, failed: 64, cancelled: 0 }),
  "/integrations/connections": (real) => connections(real),
  "/org-stats/attention": () =>
    ok({
      items: ATTENTION.map(([kind, title, detail, projectName, workflowName, since], i) => ({
        kind,
        title,
        detail,
        caseId: demoId(400 + i),
        computeTargetId: null,
        projectName,
        workflowName,
        since: ago(since),
      })),
      tasks7d: { succeeded: 412, failed: 9, blocked: 3 },
      failedRuns7d: 6,
      guardRefusals7d: 2,
    }),
  "/org-stats/cases": () =>
    ok({
      open: 38,
      waitingForHuman: 2,
      withBlockedOrFailedTasks: 2,
      closed7d: 126,
      closed30d: 504,
      time7d: { sampleSize: 126, medianActiveMs: 41 * MIN, totalActiveMs: 126 * 52 * MIN, medianElapsedMs: 5.2 * HOUR },
      time30d: { sampleSize: 504, medianActiveMs: 44 * MIN, totalActiveMs: 504 * 55 * MIN, medianElapsedMs: 5.8 * HOUR },
    }),
  "/org-stats/projects": () => ok({ total: 9, active7d: 9 }),
  "/org-stats/sessions": () => ok({ last7d: 1284, last30d: 5120 }),
  "/org-stats/workflows": () => ok({ total: 214, orchestrated: 131, process: 83, enabled: 205, disabled: 9 }),
  "/org-stats/activity": () => ok({ days: activityDays() }),
  "/org-stats/usage": () => ok(usage()),
  "/compute-targets/fleet": () => ok({ agents: AGENTS.map(fleetAgent) }),
  "/compute-targets": (real) => computeTargets(real),
  "/api/auth/organization/list": (real) => (Array.isArray(real) ? real.map((o) => ({ ...o, name: "Acme" })) : undefined),
};

export function hasDemo(pathname) {
  return Object.hasOwn(HANDLERS, pathname);
}

export function demoResponse(pathname, real) {
  const handler = HANDLERS[pathname];
  return handler ? handler(real) : undefined;
}
